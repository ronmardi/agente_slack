import { GoogleGenerativeAI } from '@google/generative-ai';
import { buscarKb, crearTicket } from './atlassian.js';

const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const genAI = new GoogleGenerativeAI(API_KEY);

const MODEL_NAME = 'gemini-flash-lite-latest';

function getSystemInstruction(usuario) {
    const nombreUsuarioSlack = usuario?.name || 'Usuario';
    const emailUsuarioSlack = usuario?.email || 'sin correo';

    return `Eres un agente de soporte técnico Nivel 0 para Slack en CMT Salud.

IDENTIFICACIÓN DEL SOLICITANTE:
- Estás conversando con: ${nombreUsuarioSlack} (${emailUsuarioSlack}).
- ${nombreUsuarioSlack} es SIEMPRE el solicitante del ticket. NUNCA le preguntes su propio nombre ni su correo, pues ya provienen directamente de su sesión de Slack.

DISTINCIÓN OBLIGATORIA (SOLICITANTE vs PERSONA A GESTIONAR):
- ${nombreUsuarioSlack} es quien pide el trámite.
- Si el requerimiento es para un tercero (crear nuevo usuario, baja de personal, fichas de pacientes, etc.), SÍ es indispensable y obligatorio pedir el NOMBRE COMPLETO DE LA PERSONA A GESTIONAR (el nuevo colaborador o paciente).

PERSISTENCIA DE CATEGORÍA:
- Una vez identificado el requerimiento (ej: 'crear nuevo usuario'), MANTÉN ESA CATEGORÍA FIJA. 
- No cambies de categoría arbitrariamente ante aclaraciones o comentarios del usuario. Responde de forma concisa y continúa solicitando los datos faltantes de esa misma solicitud.

MATRIZ DE CAMPOS OBLIGATORIOS POR SOLICITUD (SEGÚN PORTAL CMT):
1. SAGE - CREAR NUEVO USUARIO ('crear nuevo usuario'):
   - Pide DIRECTAMENTE en un solo mensaje numerado los datos que falten:
     1. Nombre completo del nuevo funcionario
     2. RUT o Pasaporte del nuevo funcionario
     3. Cargo o puesto asignado
     4. Fecha de ingreso (DD-MM-AAAA)
     5. Sucursal
   (NO pedir Anydesk).

2. SAGE - DESACTIVAR USUARIO ('desactivar o eliminar usuario'):
   - Pide: Nombre completo del funcionario a dar de baja, Usuario SAGE, RUT, Cargo, Fecha de desvinculación y Sucursal.

3. CORREOS Y CUENTAS TI:
   - 'gestionar cuentas de correo electronico': Nombre completo del funcionario para el correo, Cargo y Sucursal.
   - 'problemas de acceso o clave de correo': Correo electrónico afectado y Sucursal.
   - 'configurar cuenta de office' / 'crear modificar o configurar usuario de slack': Sucursal e ID de Anydesk.

4. SOPORTE REMOTO Y HARDWARE (Requieren Anydesk):
   - 'asistencia informatica', 'falla en huellero', 'problema con firma de paciente en wacom', 'instalar o desinstalar software':
   -> Pide: Sucursal e ID de Anydesk.
   - 'configuracion de impresora':
   -> Pide: Sucursal, ID de Anydesk y Modelo de la impresora.

5. SAGE - PACIENTES Y FICHAS:
   - 'consentimientos no registrados', 'corregir correo de paciente', 'corregir documento (rut/dni/pasaporte)', 'duplicidad de resultados', 'editar o borrar evaluacion psicologica', 'eliminar archivo de resultado erroneo', 'eliminar prescripcion medica', 'eliminar reevaluacion', 'error al visualizar consulta medica/interconsulta', 'problema en firma de informes':
   -> Pide: Sucursal, N° de Reserva, Fecha de reserva, RUT del paciente y detalle del examen o corrección.

6. GENERAL ('no encuentro mi requerimiento'):
   - Pide: Sucursal y detalle del problema.

REGLAS DE ATENCIÓN:
- Solicita los datos faltantes de forma limpia, directa y numerada, sin rodeos ni disculpas extensas.
- Al reunir todos los campos requeridos, presenta de inmediato el resumen estructurado en formato de confirmación:

📋 *Confirmación de Ticket*
> • *Tipo de Solicitud:* [Nombre de la solicitud identificada]
> • *Solicitante:* ${nombreUsuarioSlack}
> • *Sucursal:* [Sucursal indicada]
[Detalle de los datos recopilados: Nombre del nuevo colaborador, RUT, Cargo, Fechas, Anydesk, etc.]

¿Deseas que genere el ticket con esta información?

- Al confirmar el usuario ("sí", "confirmo", "dale", "ok", etc.), ejecuta INMEDIATAMENTE la herramienta 'crear_ticket' empaquetando los valores en 'campos_especificos' y entrega el enlace directo generado.`;
}

const tools = [
    {
        functionDeclarations: [
            {
                name: "buscar_kb",
                description: "Busca en la base de conocimiento de Confluence artículos y soluciones antes de escalar un ticket.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        consulta: { type: "STRING", description: "Términos de búsqueda técnica." }
                    },
                    required: ["consulta"]
                }
            },
            {
                name: "crear_ticket",
                description: "Crea el ticket en Jira Service Management clasificado según el catálogo de CMT Salud con sus campos específicos.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        tipo_solicitud: { 
                            type: "STRING", 
                            description: "Nombre normalizado del tipo de solicitud según el catálogo (ej: 'crear nuevo usuario', 'asistencia informatica', 'configuracion de impresora', 'problemas de acceso o clave de correo', 'no encuentro mi requerimiento')." 
                        },
                        resumen: { type: "STRING", description: "Título breve del requerimiento o fallo." },
                        descripcion: { type: "STRING", description: "Descripción detallada del requerimiento o problema." },
                        nombre_solicitante: { type: "STRING", description: "Nombre del usuario de Slack que solicita el ticket." },
                        sucursal: { type: "STRING", description: "Sucursal correspondiente o 'Corporativo' si no aplica." },
                        anydesk: { type: "STRING", description: "ID de Anydesk si aplica para la categoría, o 'N/A'." },
                        campos_especificos: {
                            type: "OBJECT",
                            description: "Campos obligatorios adicionales recopilados para este tipo de solicitud (ej. rut, cargo, fecha_ingreso, nombre_completo, usuario_sage, reserva, modelo_impresora)."
                        }
                    },
                    required: ["tipo_solicitud", "resumen", "descripcion"]
                }
            }
        ]
    }
];

export async function procesarMensaje(historial, usuario) {
    const geminiHistory = [];
    const lastMsg = historial.pop(); 
    
    // Reconstruir historial para la API de Gemini
    for (const item of historial) {
        let parts = [{ text: item.content }];
        if (item.image) {
            parts.unshift({ inlineData: { data: item.image.data, mimeType: item.image.mimeType } });
        }
        geminiHistory.push({
            role: item.role === 'assistant' ? 'model' : 'user',
            parts: parts
        });
    }

    try {
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            systemInstruction: getSystemInstruction(usuario),
            tools: tools
        });

        const chat = model.startChat({ history: geminiHistory });

        let iteracion = 0;
        const maxIteraciones = 6;
        
        let messageParts = [{ text: lastMsg.content }];
        if (lastMsg.image) {
            messageParts.unshift({ inlineData: { data: lastMsg.image.data, mimeType: lastMsg.image.mimeType } });
        }

        let result = await chat.sendMessage(messageParts);

        while (iteracion < maxIteraciones) {
            const functionCalls = result.response.functionCalls();
            
            if (functionCalls && functionCalls.length > 0) {
                const toolResultStrs = [];

                for (const call of functionCalls) {
                    console.log(`[Herramienta] Ejecutando: ${call.name}`);
                    let toolResultStr = "";
                    
                    try {
                        if (call.name === "buscar_kb") {
                            toolResultStr = await buscarKb(call.args.consulta);
                        } else if (call.name === "crear_ticket") {
                            call.args.nombre_solicitante = usuario?.name || call.args.nombre_solicitante || "Usuario Slack";
                            toolResultStr = await crearTicket(call.args, usuario);
                        }
                        
                        toolResultStrs.push(`Resultado de ${call.name}:\n${toolResultStr}`);
                    } catch (toolError) {
                        console.error(`[Error de Herramienta] Fallo al ejecutar ${call.name}:`, toolError);
                        toolResultStrs.push(`Resultado de ${call.name}:\nError interno al ejecutar la herramienta.`);
                    }
                }
                
                result = await chat.sendMessage(`[Sistema interno] Ejecución de herramientas completada:\n\n${toolResultStrs.join('\n\n')}`);
                iteracion++;
            } else {
                return { respuesta: result.response.text() };
            }
        }
        
        return { respuesta: "He alcanzado el límite de operaciones internas. Por favor, crea el ticket manualmente en el portal." };
    } catch (error) {
        console.error("[ERROR CRÍTICO DE GEMINI]:", error);
        throw error;
    }
}