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
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

app.post('/api/send-messages', async (req, res) => {
    if (!isReady) {
        return res.status(503).json({ error: 'El bot de WhatsApp aún no está listo o no se ha vinculado' });
    }

    const { asamblea_id, participantes, tipo_mensaje, pdf_base64, pdf_name } = req.body;

    if (!participantes || !Array.isArray(participantes)) {
        return res.status(400).json({ error: 'Se requiere una lista de participantes' });
    }

    // Retorna inmediatamente para no bloquear el request de Laravel
    res.status(200).json({ status: 'Enqueued', message: 'Los mensajes se encolaron con protección Anti-Spam.' });

    // Función asíncrona autoejecutable en segundo plano
    (async () => {
        console.log(`\n▶ Iniciando Cola Anti-Spam para ${participantes.length} usuarios de Asamblea ${asamblea_id}...`);

        let count = 0;
        for (const p of participantes) {
            count++;
            if (!p.telefono) {
                console.log(`[${count}/${participantes.length}] ⚠️ Saltando a ${p.nombre} (No tiene teléfono)`);
                continue;
            }

            let numStr = p.telefono.replace(/\D/g, '');

            // Validar si el número está registrado en WhatsApp
            let chatId = '';
            try {
                const registeredUser = await client.getNumberId(numStr);
                if (!registeredUser) {
                    console.log(`[${count}/${participantes.length}] ❌ Saltando a ${p.nombre} (${numStr}) - Número no tiene WhatsApp activo.`);
                    continue;
                }
                chatId = registeredUser._serialized;
            } catch (err) {
                console.log(`[${count}/${participantes.length}] ❌ Error validando número de ${p.nombre} (${numStr}):`, err.message);
                continue;
            }

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
                mensaje = `Hola *${p.nombre}*,\n\nTe compartimos el enlace oficial para que puedas acceder al portal de votación de la asamblea.\n\n🔗 *Enlace:* ${p.link}\n🔑 *Código de Verificación:* ${p.codigo_verificacion}\n\nPor favor, no compartas este código con nadie.`;
            }

            try {
                // Simular humano "Escribiendo..." antes de enviar (Opcional, pero muy efectivo anti-spam)
                try {
                    const chat = await client.getChatById(chatId);
                    await chat.sendStateTyping();
                    await delay(randomDelay(1000, 2500)); // Escribe entre 1 y 2.5 segs
                } catch (e) {
                    // Si falla (por ejemplo, el chat no existe), continuamos normal
                }

                if (media) {
                    await client.sendMessage(chatId, media, { caption: mensaje });
                } else {
                    await client.sendMessage(chatId, mensaje);
                }

                console.log(`[${count}/${participantes.length}] ✅ Mensaje enviado a ${p.nombre} (${numStr})`);

                // Pausa entre mensajes Aleatoria (Jitter) para evitar bans (2.5s a 6s)
                const jitter = randomDelay(2500, 6000);
                await delay(jitter);

                // Batching: Cada 15 mensajes, pausa larga de 15 a 30 segundos
                if (count % 15 === 0 && count < participantes.length) {
                    const longPause = randomDelay(15000, 30000);
                    console.log(`⏳ Descanso Anti-Spam: Pausando por ${Math.round(longPause / 1000)} segundos...`);
                    await delay(longPause);
                }

            } catch (error) {
                console.error(`[${count}/${participantes.length}] ❌ Error al enviar a ${p.nombre} (${numStr}):`, error.message);
            }
        }

        console.log('✅ Cola de envío completada exitosamente.');

        // Limpieza de memoria explícita
        if (req.body.pdf_base64) {
            req.body.pdf_base64 = null;
        }
    })();
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Servidor Bot escuchando en http://localhost:${PORT}`);
});
