const express = require('express');
const { GoogleAuth } = require('google-auth-library');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PROJECT_ID = 'asistencia-inicial';

// Credenciales de Firebase (se configuran como variable de entorno)
const getFirebaseCredentials = () => {
    const base64Credentials = process.env.FIREBASE_CREDENTIALS_BASE64;
    if (!base64Credentials) {
        throw new Error('FIREBASE_CREDENTIALS_BASE64 no está configurado');
    }
    const credentialsJson = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    return JSON.parse(credentialsJson);
};

// Endpoint para recibir notificaciones de Supabase
app.post('/send-notification', async (req, res) => {
    try {
        const { token, title, body, data } = req.body;

        console.log('📤 Enviando notificación:', { title, body });

        // Obtener credenciales de Firebase
        const credentials = getFirebaseCredentials();

        // Obtener token de acceso OAuth2
        const auth = new GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        });

        const accessToken = await auth.getAccessToken();

        // Enviar notificación a Firebase FCM API v1
        const response = await fetch(
            `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    message: {
                        token: token,
                        notification: {
                            title: title,
                            body: body,
                        },
                        data: data || {},
                        android: {
                            priority: 'high',
                            notification: {
                                sound: 'default',
                                channel_id: 'high_importance_channel',
                            },
                        },
                    },
                }),
            }
        );

        const result = await response.json();

        if (response.ok) {
            console.log('✅ Notificación enviada:', result);
            res.json({ success: true, result });
        } else {
            console.error('❌ Error de Firebase:', result);
            res.status(500).json({ success: false, error: result });
        }
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint de salud
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Servidor de notificaciones funcionando' });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
