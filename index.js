const express = require('express');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(cors());
app.use(express.json());

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

let isReady = false;

client.on('qr', (qr) => {
    console.log('\n--- ESCANEA ESTE CÓDIGO QR EN TU TELÉFONO PARA VINCULAR EL WHATSAPP BOT ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    isReady = true;
    console.log('¡Cliente de WhatsApp listo y vinculado exitosamente!');
});

client.on('auth_failure', msg => {
    console.error('Fallo en la autenticación', msg);
});

client.initialize();

const delay = ms => new Promise(res => setTimeout(res, ms));

app.post('/api/send-messages', async (req, res) => {
    if (!isReady) {
        return res.status(503).json({ error: 'El bot de WhatsApp aún no está listo o no se ha vinculado' });
    }

    const { asamblea_id, participantes, tipo_mensaje, pdf_base64, pdf_name } = req.body;

    if (!participantes || !Array.isArray(participantes)) {
        return res.status(400).json({ error: 'Se requiere una lista de participantes' });
    }

    res.status(200).json({ status: 'Enqueued', message: 'Los mensajes se enviarán en segundo plano.' });

    console.log(`\nIniciando envío para ${participantes.length} participantes de la Asamblea ${asamblea_id}...`);

    for (const p of participantes) {
        if (!p.telefono) continue;

        // Limpiar para dejar sólo números
        let numStr = p.telefono.replace(/\D/g, '');
        // El formato de whatsapp-web.js requiere el chatId con @c.us (e.g. 573001234567@c.us)
        const chatId = `${numStr}@c.us`;

        let mensaje = '';
        let media = null;
        if (tipo_mensaje === 'VERIFICACION') {
            mensaje = `Hola *${p.nombre}*,\n\nSe ha realizado una verificación de asistencia global en la asamblea. Por seguridad, te enviamos tu *NUEVO* código de acceso vigente.\n\n🔗 *Enlace:* ${p.link}\n🔑 *Nuevo Código:* ${p.codigo_verificacion}\n\nPor favor, ingresa este código para continuar votando.`;
        } else if (tipo_mensaje === 'REINGRESO') {
            mensaje = `Hola *${p.nombre}*,\n\nSe ha registrado tu reingreso a la asamblea. Por favor, utiliza tu *NUEVO* código de acceso para volver a entrar al portal de votación.\n\n🔗 *Enlace:* ${p.link}\n🔑 *Nuevo Código:* ${p.codigo_verificacion}\n\nPor favor, ingresa este código para continuar.`;
        } else if (tipo_mensaje === 'REPORTE_FINAL') {
            mensaje = `Hola *${p.nombre}*, la asamblea ha finalizado.\n\nAdjunto encontrarás el reporte final oficial en formato PDF.\n\nGracias por tu participación.`;
            if (pdf_base64) {
                media = new MessageMedia('application/pdf', pdf_base64, pdf_name || 'Reporte_Asamblea.pdf');
            }
        } else {
            // Default (INGRESO)
            mensaje = `Hola *${p.nombre}*,\n\nTe compartimos el enlace oficial para que puedas acceder al portal de votación de la asamblea.\n\n🔗 *Enlace:* ${p.link}\n🔑 *Código de Verificación:* ${p.codigo_verificacion}\n\nPor favor, no compartas este código con nadie.`;
        }

        try {
            if (media) {
                await client.sendMessage(chatId, media, { caption: mensaje });
            } else {
                await client.sendMessage(chatId, mensaje);
            }
            console.log(`✅ Mensaje enviado a ${p.nombre} (${numStr})`);
            // Pausa entre mensajes para evitar bans por spam
            await delay(1500);
        } catch (error) {
            console.error(`❌ Error al enviar a ${p.nombre} (${numStr}):`, error.message);
        }
    }

    console.log('Envío de lote completado.');
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Servidor Bot escuchando en http://localhost:${PORT}`);
});
