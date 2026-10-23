import 'dotenv/config';
import { App } from '@slack/bolt';
import axios from 'axios';
import { procesarMensaje } from './agente.js';
import http from 'http';

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bot de Soporte TI CMT Salud: Activo');
    } else {
        res.writeHead(404);
        res.end();
    }
}).listen(PORT, () => {
    console.log(`[HTTP Health] Servidor escuchando en el puerto ${PORT}`);
});

// Imprimir en consola los tokens cargados (máscara de seguridad)
console.log("Comprobando variables de entorno:");
console.log("SLACK_BOT_TOKEN:", process.env.SLACK_BOT_TOKEN ? "Cargado OK" : "FALTANTE / UNDEFINED");
console.log("SLACK_APP_TOKEN:", process.env.SLACK_APP_TOKEN ? "Cargado OK" : "FALTANTE / UNDEFINED");
console.log("SLACK_SIGNING_SECRET:", process.env.SLACK_SIGNING_SECRET ? "Cargado OK" : "FALTANTE / UNDEFINED");

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
    port: process.env.PORT || 3000
});

const chatHistories = new Map();

// Convierte Markdown estándar de Gemini al formato nativo mrkdwn de Slack
function markdownToSlack(text) {
    if (!text) return "";
    return text
        // Convierte viñetas de lista estándar (* o - al inicio de línea) a símbolo de viñeta limpio
        .replace(/^\s*[\*\-]\s+/gm, '• ')
        // Convierte negritas dobles **texto** o __texto__ a *texto*
        .replace(/\*\*(.*?)\*\*/g, '*$1*')
        .replace(/__(.*?)__/g, '*$1*')
        // Convierte enlaces Markdown [texto](url) a formato Slack <url|texto>
        .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>');
}

// Función auxiliar para descargar y convertir imágenes de Slack a Base64 para Gemini
async function procesarImagenSlack(file, botToken) {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
        throw new Error("Formato de imagen no permitido. Solo se aceptan JPEG, PNG o WEBP.");
    }
    
    if (file.size > 2000000) {
        throw new Error("La imagen excede el límite de tamaño permitido (~2 MB).");
    }

    const response = await axios.get(file.url_private, {
        headers: { 'Authorization': `Bearer ${botToken}` },
        responseType: 'arraybuffer'
    });

    return {
        mimeType: file.mimetype,
        data: Buffer.from(response.data, 'binary').toString('base64')
    };
}

app.message(async ({ message, say, client }) => {
    if (message.bot_id) return;

    try {
        const userInfo = await client.users.profile.get({ user: message.user });
        const usuarioSlack = {
            email: userInfo.profile.email,
            name: userInfo.profile.real_name || userInfo.profile.display_name
        };

        const textoUsuario = message.text || "Usuario envió una imagen.";
        if (textoUsuario.length > 2000) {
            await say("Mensaje demasiado largo (máximo 2000 caracteres).");
            return;
        }

        let imageObj = null;
        if (message.files && message.files.length > 0) {
            try {
                imageObj = await procesarImagenSlack(message.files[0], process.env.SLACK_BOT_TOKEN);
            } catch (imgError) {
                await say(imgError.message);
                return;
            }
        }

        // 1. Recuperar historial previo
        let historial = chatHistories.get(usuarioSlack.email) || [];
        
        // 2. Agregar el mensaje actual del usuario
        historial.push({ 
            role: "user", 
            content: textoUsuario, 
            image: imageObj 
        });

        await say({ text: "_Procesando tu solicitud..._", thread_ts: message.ts });

        // 3. Enviamos una copia con [...historial] para preservar el historial original
        const { respuesta } = await procesarMensaje([...historial], usuarioSlack);

        // 4. Guardar la respuesta original en el historial para contexto de IA
        historial.push({
            role: "assistant",
            content: respuesta
        });

        if (historial.length > 20) historial = historial.slice(-20);

        // 5. Guardar el historial actualizado
        chatHistories.set(usuarioSlack.email, historial);

        // 6. Enviar la respuesta formateada a Slack
        await say({ 
            text: markdownToSlack(respuesta), 
            thread_ts: message.ts 
        });

    } catch (error) {
        console.error("Error procesando chat:", error);
        await say("Error interno del servidor. Por favor, intenta más tarde.");
    }
});

// Comando para reiniciar el historial de conversación
app.command('/reset-chat', async ({ command, ack, respond, client }) => {
    await ack();
    const userInfo = await client.users.profile.get({ user: command.user_id });
    chatHistories.delete(userInfo.profile.email);
    await respond("Historial de conversación reiniciado exitosamente.");
});

(async () => {
    await app.start();
    console.log(`⚡️ Slack Bot está corriendo de forma local con soporte para imágenes!`);
})();