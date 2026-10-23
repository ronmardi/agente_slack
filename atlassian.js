const SITE = process.env.ATLASSIAN_SITE;
const EMAIL = process.env.ATLASSIAN_EMAIL;
const TOKEN = process.env.ATLASSIAN_TOKEN;
const SPACE = process.env.CONFLUENCE_SPACE;
const SD_ID = process.env.SERVICE_DESK_ID || "1";

// Solicitud universal de respaldo (RT 20: "No encuentro mi requerimiento").
// Solo exige Resumen, Sucursal, Nombre del solicitante y Descripción (sin Anydesk ni formularios de RRHH).
const RT_UNIVERSAL = "20";
const RT_ID = (process.env.REQUEST_TYPE_ID && process.env.REQUEST_TYPE_ID !== "2") ? process.env.REQUEST_TYPE_ID : RT_UNIVERSAL;
const TICKET_MODE = process.env.TICKET_MODE;

const authHeader = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;
const headers = {
    'Authorization': authHeader,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
};

// Función auxiliar para normalizar texto (sin tildes, minúsculas y sin espacios extra)
function normalizar(texto) {
    return (texto || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

// Convierte fechas DD/MM/AAAA o DD-MM-AAAA al formato ISO AAAA-MM-DD que requiere Jira
function normalizarFecha(fechaStr) {
    if (!fechaStr) return null;
    const s = String(fechaStr).trim();
    const match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
        const dia = match[1].padStart(2, '0');
        const mes = match[2].padStart(2, '0');
        const anio = match[3];
        return `${anio}-${mes}-${dia}`;
    }
    return s;
}

// Busca valores en objetos ignorando mayúsculas, guiones y caracteres especiales
function buscarCampo(obj, ...claves) {
    if (!obj || typeof obj !== 'object') return null;
    for (const clave of claves) {
        const normClave = clave.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const [k, v] of Object.entries(obj)) {
            const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normK === normClave && v && !['n/a', 'no requerido', 'ninguno', 'none'].includes(String(v).toLowerCase().trim())) {
                return String(v).trim();
            }
        }
    }
    return null;
}

// Diccionario de IDs de sucursales según Jira[cite: 10]
const SUCURSALES_MAP = {
    'ambulatoria': '10032',
    'antofagasta centro': '10020',
    'antofagasta norte': '10389',
    'arequipa': '10456',
    'calama': '10033',
    'campana terreno (peru)': '10056',
    'campaña terreno (perú)': '10056',
    'concepcion': '10025',
    'concepción': '10025',
    'concepcion centro': '13144',
    'concepción centro': '13144',
    'copiapo': '10035',
    'copiapó': '10035',
    'coquimbo': '10961',
    'corporativo': '10031',
    'curico': '13145',
    'curicó': '13145',
    'escuela militar': '10455',
    'iquique': '10051',
    'la florida': '10034',
    'la serena': '10021',
    'los angeles': '13146',
    'los ángeles': '13146',
    'magdalena del mar': '10048',
    'providencia': '10023',
    'puerto montt': '10037',
    'punta arenas': '10057',
    'rancagua': '10024',
    'santiago': '10022',
    'talca': '10049',
    'temuco': '13147',
    'terreno': '10052',
    'valdivia': '10050',
    'vina del mar': '10036',
    'viña del mar': '10036',
    'vina del mar oriente': '11795',
    'viña del mar oriente': '11795'
};

// Catálogo completo de Request Types de Jira Service Management (50 tipos de solicitud)[cite: 10]
export const TIPOS_SOLICITUD_MAP = {
    // ⚡ Soporte Crítico y Dudas
    "no encuentro mi requerimiento": "20",

    // 🔐 SAGE - Cuentas y Accesos
    "cambio de cargo o puesto": "59",
    "crear nueva sucursal o sede": "1545",
    "crear nuevo usuario": "27",
    "desactivar o eliminar usuario": "47",
    "gestionar clave de sobrecupo": "44",
    "habilitar firma isl": "41",
    "habilitar firma y numero sis de doctores": "48",
    "otorgar acceso a sucursales": "42",
    "otorgar roles de usuarios": "43",

    // 🩺 SAGE - Errores y Gestión de Pacientes
    "consentimientos no registrados": "65",
    "corregir correo de paciente": "63",
    "corregir documento (rut/dni/pasaporte)": "36",
    "duplicidad de resultados": "60",
    "editar o borrar evaluacion psicologica": "35",
    "eliminar archivo de resultado erroneo": "52",
    "eliminar prescripcion medica": "68",
    "eliminar reevaluacion": "71",
    "error al visualizar consulta medica/interconsulta": "67",
    "modificar tipo de evaluacion en informe": "46",
    "modificar vigencia de informes del paciente/trabajador": "57",
    "modificar vigencia de reevaluacion": "51",
    "problema en firma de informes": "25",
    "problema para reevaluar a paciente (subir archivo)": "66",

    // 🏢 SAGE - Configuraciones de Empresa
    "asociar empresa a holding": "1276",
    "anadir modificar o eliminar credito o convenio de empresa": "19",
    "error al descargar o ver informes": "38",
    "gestionar empresas particulares": "55",
    "gestionar usuarios de empresas cliente": "40",
    "habilitar modificar o inhabilitar centro de costo": "50",
    "modificar datos o razon social de empresa": "34",
    "modificar pais asignado a empresa": "402",
    "modificar sub-empresa isl": "61",
    "problemas de acceso a portal de clientes": "39",
    "problemas de facturacion": "33",

    // 📊 SAGE - Gestión de Baterías y Exámenes
    "agregar codigo a baterias": "62",
    "crear modificar o eliminar bateria y/o examen": "14",

    // 💻 TI - Soporte de Software y Cuentas
    "configurar cuenta de office": "11",
    "crear modificar o configurar usuario de slack": "22",
    "gestionar cuentas de correo electronico": "37",
    "instalar o desinstalar software": "56",
    "problemas de acceso o clave de correo": "13",

    // 📦 TI - Préstamo y Soporte de Equipos
    "asistencia informatica": "2",
    "configuracion de impresora": "23",
    "prestamo de perifericos ti": "369",
    "prestamo de equipos": "74",

    // 🛠️ TI - Hardware Especializado
    "falla en huellero": "53",
    "problema con firma de paciente en wacom": "54",

    // 🛒 TI - Compras y Adquisiciones
    "compra de equipos o accesorios computacionales": "29",

    // ⚙️ TI - Mantención de Hardware
    "mantencion de equipos computacionales": "15",

    // Alias y atajos habituales
    "impresora": "23",
    "huellero": "53",
    "wacom": "54",
    "correo": "13",
    "office": "11",
    "slack": "22",
    "asistencia": "2"
};

const camposValidosCache = new Map();

// Consulta qué campos acepta el formulario del portal para un requestTypeId específico[cite: 10]
async function obtenerCamposValidos(requestTypeId) {
    if (camposValidosCache.has(requestTypeId)) {
        return camposValidosCache.get(requestTypeId);
    }
    try {
        const url = `https://${SITE}/rest/servicedeskapi/servicedesk/${SD_ID}/requesttype/${requestTypeId}/field`;
        const res = await fetch(url, { headers });
        if (res.ok) {
            const data = await res.json();
            const fieldsList = data.values || data.requestTypeFields || [];
            const validIds = new Set(fieldsList.map(f => f.fieldId));
            camposValidosCache.set(requestTypeId, validIds);
            return validIds;
        }
    } catch (e) {
        console.warn(`[Atlassian] No se pudo verificar campos de RT ${requestTypeId}:`, e.message);
    }
    return null;
}

export async function buscarKb(consulta) {
    try {
        const cql = `space = "${SPACE}" AND type = page AND text ~ "${consulta.replace(/"/g, '\\"')}"`;
        const searchUrl = `https://${SITE}/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=3`;
        
        const searchRes = await fetch(searchUrl, { headers });
        if (!searchRes.ok) return "No se encontraron resultados o hubo un error en la búsqueda.";
        
        const searchData = await searchRes.json();
        const resultados = [];
        
        for (const item of searchData.results) {
            const contentUrl = `https://${SITE}/wiki/rest/api/content/${item.content.id}?expand=body.storage`;
            const contentRes = await fetch(contentUrl, { headers });
            if (contentRes.ok) {
                const contentData = await contentRes.json();
                let texto = contentData.body.storage.value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                resultados.push(`Título: ${item.title}\nContenido: ${texto.substring(0, 4000)}`);
            }
        }
        return resultados.length ? resultados.join("\n\n---\n\n") : "No hay artículos relevantes.";
    } catch (error) {
        console.error("Error buscando en KB:", error);
        return "Error interno al buscar en la base de conocimiento.";
    }
}

async function obtenerOCrearCliente(email, nombre) {
    if (!email) {
        console.warn("[Modo A] No se recibió el correo del usuario.");
        return null;
    }

    try {
        console.log(`[Modo A] Buscando usuario en el directorio de Jira para: ${email}...`);
        
        const searchUserUrl = `https://${SITE}/rest/api/3/user/search?query=${encodeURIComponent(email)}`;
        let res = await fetch(searchUserUrl, { headers });
        
        if (res.ok) {
            const users = await res.json();
            if (Array.isArray(users) && users.length > 0) {
                console.log(`[Modo A] ¡Usuario encontrado en Jira!: ${users[0].displayName} (ID: ${users[0].accountId})`);
                return users[0].accountId;
            }
        }

        console.log(`[Modo A] No es usuario interno. Buscando en clientes del portal...`);
        const searchCustomerUrl = `https://${SITE}/rest/servicedeskapi/customer?query=${encodeURIComponent(email)}`;
        res = await fetch(searchCustomerUrl, { headers });
        if (res.ok) {
            const data = await res.json();
            if (data.values && data.values.length > 0) {
                console.log(`[Modo A] ¡Cliente encontrado en portal!: ${data.values[0].displayName} (ID: ${data.values[0].accountId})`);
                return data.values[0].accountId;
            }
        }

        console.log(`[Modo A] Usuario nuevo. Creando cliente en JSM para: ${email}...`);
        res = await fetch(`https://${SITE}/rest/servicedeskapi/customer`, {
            method: 'POST',
            headers: { ...headers, 'X-ExperimentalApi': 'opt-in' },
            body: JSON.stringify({ email, fullName: nombre || email.split('@')[0] })
        });

        if (res.ok) {
            const nuevoCliente = await res.json();
            console.log(`[Modo A] Cliente creado con éxito (ID: ${nuevoCliente.accountId})`);
            return nuevoCliente.accountId;
        } else {
            const errDetalle = await res.text();
            console.error(`[Modo A] Jira rechazó la creación del cliente (${res.status}):`, errDetalle);
        }

        return null;
    } catch (e) {
        console.error("[Modo A] Excepción gestionando cliente en Jira:", e);
        return null;
    }
}

export async function crearTicket(args, usuario) {
    // El solicitante SIEMPRE es el usuario autenticado de Slack
    const solicitanteReal = usuario?.name || args.nombre_solicitante || "Usuario Slack";

    // 1. Resolver Sucursal[cite: 10]
    const sucursalTexto = normalizar(args.sucursal);
    const sucursalId = SUCURSALES_MAP[sucursalTexto] || '10031'; // Default: Corporativo[cite: 10]

    // 2. Resolver Request Type ID dinámico[cite: 10]
    const tipoNorm = normalizar(args.tipo_solicitud);
    const requestTypeId = TIPOS_SOLICITUD_MAP[tipoNorm] || RT_ID || RT_UNIVERSAL;

    console.log(`[Atlassian] Creando ticket -> Tipo: "${args.tipo_solicitud}" | Solicitante: "${solicitanteReal}" | RT: ${requestTypeId}`);

    // Extraer campos recopilados tanto del objeto args como de campos_especificos[cite: 10]
    const extra = { ...args, ...(args.campos_especificos || {}) };

    // 3. Consultar campos admitidos por el formulario de Jira[cite: 10]
    const camposPermitidos = await obtenerCamposValidos(requestTypeId);

    const requestFieldValues = {
        summary: args.resumen
    };

    let debeAdjuntarComentario = false;

    // Asignar descripción limpia solo si el formulario de la solicitud lo admite[cite: 10]
    if (!camposPermitidos || camposPermitidos.has('description')) {
        requestFieldValues.description = args.descripcion;
    } else {
        debeAdjuntarComentario = true;
    }

    // Solicitante y Sucursal[cite: 10]
    if (!camposPermitidos || camposPermitidos.has('customfield_10042')) {
        requestFieldValues.customfield_10042 = { id: sucursalId };
    }
    if (!camposPermitidos || camposPermitidos.has('customfield_10087')) {
        requestFieldValues.customfield_10087 = solicitanteReal;
    }

    // Inyección de Custom Fields nativos de Jira según catálogo[cite: 10]
    const rutVal = buscarCampo(extra, 'rut', 'pasaporte', 'rut_pasaporte', 'rut_usuario');
    if (rutVal && (!camposPermitidos || camposPermitidos.has('customfield_10052'))) {
        requestFieldValues.customfield_10052 = rutVal;
    }

    // Nombre completo del funcionario/paciente a gestionar (sin mezclar con el solicitante)
    const nombreCompletoVal = buscarCampo(extra, 'nombre_completo', 'nombre_paciente', 'nuevo_usuario', 'nombre_funcionario');
    if (nombreCompletoVal && (!camposPermitidos || camposPermitidos.has('customfield_10053'))) {
        requestFieldValues.customfield_10053 = nombreCompletoVal;
    }

    const cargoVal = buscarCampo(extra, 'cargo', 'puesto');
    if (cargoVal && (!camposPermitidos || camposPermitidos.has('customfield_10054'))) {
        requestFieldValues.customfield_10054 = cargoVal;
    }

    const cargoAntiguoVal = buscarCampo(extra, 'cargo_antiguo');
    if (cargoAntiguoVal && (!camposPermitidos || camposPermitidos.has('customfield_10081'))) {
        requestFieldValues.customfield_10081 = cargoAntiguoVal;
    }

    const cargoNuevoVal = buscarCampo(extra, 'cargo_nuevo');
    if (cargoNuevoVal && (!camposPermitidos || camposPermitidos.has('customfield_10080'))) {
        requestFieldValues.customfield_10080 = cargoNuevoVal;
    }

    const fechaIngresoVal = normalizarFecha(buscarCampo(extra, 'fecha_ingreso', 'fecha_desvinculacion', 'fecha_ingreso_desvinculacion', 'fecha'));
    if (fechaIngresoVal && (!camposPermitidos || camposPermitidos.has('customfield_10259'))) {
        requestFieldValues.customfield_10259 = fechaIngresoVal;
    }

    const usuarioSageVal = buscarCampo(extra, 'usuario_sage', 'usuario', 'cuenta_sage');
    if (usuarioSageVal) {
        if (!camposPermitidos || camposPermitidos.has('customfield_10056')) {
            requestFieldValues.customfield_10056 = usuarioSageVal;
        } else if (camposPermitidos.has('customfield_10055')) {
            requestFieldValues.customfield_10055 = usuarioSageVal;
        }
    }

    const reservaVal = buscarCampo(extra, 'reserva', 'numero_reserva', 'n_reserva');
    if (reservaVal && (!camposPermitidos || camposPermitidos.has('customfield_10061'))) {
        requestFieldValues.customfield_10061 = reservaVal;
    }

    const fechaReservaVal = normalizarFecha(buscarCampo(extra, 'fecha_reserva', 'fecha_de_reserva'));
    if (fechaReservaVal && (!camposPermitidos || camposPermitidos.has('customfield_10043'))) {
        requestFieldValues.customfield_10043 = fechaReservaVal;
    }

    const anydeskVal = args.anydesk || buscarCampo(extra, 'anydesk');
    if (anydeskVal && anydeskVal !== 'N/A' && anydeskVal.toLowerCase() !== 'no requerido') {
        if (!camposPermitidos || camposPermitidos.has('customfield_10065')) {
            requestFieldValues.customfield_10065 = String(anydeskVal);
        }
    }

    const modeloImpresoraVal = buscarCampo(extra, 'modelo_impresora', 'impresora', 'modelo');
    if (modeloImpresoraVal && (!camposPermitidos || camposPermitidos.has('customfield_10098'))) {
        requestFieldValues.customfield_10098 = modeloImpresoraVal;
    }

    const autorizadoPorVal = buscarCampo(extra, 'autorizado_por', 'autorizado');
    if (autorizadoPorVal && (!camposPermitidos || camposPermitidos.has('customfield_10097'))) {
        requestFieldValues.customfield_10097 = autorizadoPorVal;
    }

    const payload = {
        serviceDeskId: SD_ID,
        requestTypeId: requestTypeId,
        requestFieldValues: requestFieldValues
    };

    try {
        if (TICKET_MODE === 'A') {
            const accountId = await obtenerOCrearCliente(usuario?.email, usuario?.name);
            if (accountId) {
                payload.raiseOnBehalfOf = accountId;
            }
        }

        // 4. Envío y auto-recuperación transparente[cite: 10]
        let intentos = 0;
        let res = null;
        let data = null;

        while (intentos < 3) {
            intentos++;
            res = await fetch(`https://${SITE}/rest/servicedeskapi/request`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                data = await res.json();
                break;
            }

            const errDetalle = await res.text();
            console.warn(`[Atlassian Intento ${intentos}] Jira rechazó (${res.status}): ${errDetalle}`);

            // CASO 1: Faltan campos obligatorios propios de ese formulario de portal[cite: 10]
            if (errDetalle.includes('campo obligatorio') || 
                errDetalle.includes('required') || 
                errDetalle.includes('mandatory') ||
                errDetalle.includes('sd.validation.request.creation.failure.required.field')) {
                
                if (payload.requestTypeId === RT_UNIVERSAL) {
                    console.error("[Atlassian] Error persistente de validación en la solicitud universal.");
                    break;
                }

                console.log(`[Atlassian Auto-Fix] Redirigiendo a solicitud universal RT ${RT_UNIVERSAL}...`);
                payload.requestTypeId = RT_UNIVERSAL;
                payload.requestFieldValues = {
                    summary: `[${args.tipo_solicitud || 'Solicitud'}] ${args.resumen}`,
                    description: args.descripcion,
                    customfield_10042: { id: sucursalId },
                    customfield_10087: solicitanteReal
                };
                debeAdjuntarComentario = false;
                continue;
            }

            // CASO 2: Jira objeta un campo no admitido en esa pantalla[cite: 10]
            const matchCampo = errDetalle.match(/(?:campo|field)\s+'([^']+)'\s+(?:no es válido|is not valid|is invalid|cannot be set)/i);
            if (matchCampo && matchCampo[1]) {
                const campoInvalido = matchCampo[1];
                console.log(`[Atlassian Auto-Fix] Omitiendo campo no admitido '${campoInvalido}' y reintentando...`);
                delete payload.requestFieldValues[campoInvalido];
                if (campoInvalido === 'description') {
                    debeAdjuntarComentario = true;
                }
                continue;
            }

            // CASO 3: Error general con customfields, reintentar con campos básicos universales[cite: 10]
            if (errDetalle.includes('customfield') || errDetalle.includes('cannot be set')) {
                console.log(`[Atlassian Auto-Fix] Limpiando customfields de la solicitud y reintentando...`);
                const basicos = { summary: payload.requestFieldValues.summary };
                if (payload.requestFieldValues.description) basicos.description = payload.requestFieldValues.description;
                payload.requestFieldValues = basicos;
                continue;
            }

            break;
        }

        if (!res || !res.ok || !data) {
            return `No se pudo crear el ticket. Por favor ingresa a: ${process.env.PORTAL_URL}`;
        }

        // 5. Si la pantalla original no admitía descripción, adjuntar solo la descripción limpia
        if (debeAdjuntarComentario && (data.issueKey || data.issueId) && args.descripcion?.trim()) {
            try {
                await fetch(`https://${SITE}/rest/servicedeskapi/request/${data.issueKey || data.issueId}/comment`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        body: args.descripcion.trim(),
                        public: true
                    })
                });
                console.log(`[Atlassian] Nota adjuntada limpiamente en ${data.issueKey}`);
            } catch (commentErr) {
                console.warn("[Atlassian] No se pudo adjuntar comentario:", commentErr.message);
            }
        }

        return `Ticket creado con éxito: ${data.issueKey}. URL: ${data._links.web}`;

    } catch (error) {
        console.error("Excepción creando ticket:", error);
        return `Ocurrió un error al crear el ticket. Intenta manualmente en: ${process.env.PORTAL_URL}`;
    }
}