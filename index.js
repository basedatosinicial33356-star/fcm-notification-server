/*
  BACKEND DE NOTIFICACIONES SGE
  -----------------------------
  Este servidor:
  1. Recibe un Webhook desde Supabase (POST /webhook/attendance) cuando hay un INSERT en 'attendance_records'.
  2. Extrae el student_id del payload crudo.
  3. Consulta a Supabase para obtener el padre y su fcm_token.
  4. Envía la notificación Push a través de Firebase FCM API v1 usando Google Auth.
*/

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleAuth } = require('google-auth-library');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
// IMPORTANTE: Pon tu Project ID de Firebase aquí o en variable de entorno
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'asistencia-inicial';

// --- CONFIGURACIÓN SUPABASE ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Faltan env vars: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  // No exit here to allow Render build to pass, but log error
}

const supabase = createClient(supabaseUrl || '', supabaseServiceKey || '');

// --- UTILIDADES FIREBASE ---
const getAccessToken = async () => {
  const base64Credentials = process.env.FIREBASE_CREDENTIALS_BASE64;
  if (!base64Credentials) {
    throw new Error('Falta env var: FIREBASE_CREDENTIALS_BASE64');
  }

  const credentialsJson = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const credentials = JSON.parse(credentialsJson);

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  return await auth.getAccessToken();
};

const sendPushNotification = async (token, title, body, data) => {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
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
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
};

// --- ENDPOINTS ---

// 1. Webhook Principal (Lo llama Supabase)
app.post('/webhook/attendance', async (req, res) => {
  try {
    const { type, table, record } = req.body;

    console.log(`📥 Webhook recibido: ${type} en ${table}`);

    // Solo nos interesa INSERT en attendance_records
    if (type !== 'INSERT' || table !== 'attendance_records') {
      return res.status(200).send('Ignored');
    }

    const newRecord = record;
    const studentId = newRecord.student_id;
    const attendanceType = newRecord.type; // 'entry' o 'exit'

    // a. Obtener estudiante y padre
    const { data: student, error: sError } = await supabase
      .from('students')
      .select('full_name, parent_id')
      .eq('id', studentId)
      .single();

    if (sError || !student) {
      console.error('❌ Error estudiante:', sError);
      return res.status(404).send('Student not found');
    }

    if (!student.parent_id) {
      console.log('ℹ️ Estudiante sin padre');
      return res.status(200).send('No parent assigned');
    }

    // b. Obtener token del padre
    const { data: parent, error: pError } = await supabase
      .from('users')
      .select('fcm_token')
      .eq('id', student.parent_id)
      .single();

    if (pError || !parent?.fcm_token) {
      console.log('ℹ️ Padre sin token FCM');
      return res.status(200).send('No FCM token');
    }

    // c. Preparar mensaje
    const title = 'SGE - Notificación de Asistencia';
    const body = attendanceType === 'entry'
      ? `✅ ${student.full_name} ha INGRESADO al colegio.`
      : `🏠 ${student.full_name} ha SALIDO del colegio.`;

    // d. Enviar
    console.log(`📤 Enviando Push a ${student.parent_id}...`);
    await sendPushNotification(parent.fcm_token, title, body, {
      studentId: studentId,
      type: attendanceType,
      click_action: 'FLUTTER_NOTIFICATION_CLICK'
    });

    console.log('✅ Notificación enviada exitosamente');
    res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ Error procesando webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Health Check
app.get('/', (req, res) => {
  res.send('SGE Notification Backend is Running 🚀');
});

// 3. Keep Alive (Wake Up)
app.get('/wake-up', (req, res) => {
  console.log('⏰ I am awake!');
  res.send('Awake');
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
