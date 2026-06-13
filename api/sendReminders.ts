import admin from "firebase-admin";

function initializeAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : undefined;

    if (serviceAccount && serviceAccount.project_id) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      });
    } else {
      admin.initializeApp();
    }
  }
  return admin.app();
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    initializeAdmin();
    const firestore = admin.firestore();
    const messaging = admin.messaging();
    const now = admin.firestore.Timestamp.now();

    const remindersQuery = await firestore
      .collection("scheduledNotifications")
      .where("sent", "==", false)
      .where("scheduledTime", "<=", now)
      .get();

    const processed: any[] = [];

    for (const reminderDoc of remindersQuery.docs) {
      const reminder = reminderDoc.data();
      const { userId, title, message, type } = reminder;
      if (!userId || !title || !message) {
        await reminderDoc.ref.update({ sent: true, sentAt: admin.firestore.FieldValue.serverTimestamp() });
        continue;
      }

      const userDoc = await firestore.collection("users").doc(userId).get();
      const userToken = userDoc.exists ? userDoc.get("fcmToken") : null;

      try {
        if (userToken) {
          await messaging.sendToDevice(userToken, {
            notification: {
              title: title,
              body: message,
            },
            data: {
              type: type || "scheduled",
              userId,
            },
          });
        }

        await firestore.collection("notifications").add({
          userId,
          title,
          message,
          type: type || "scheduled",
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.error("Failed to send scheduled reminder", error);
      } finally {
        await reminderDoc.ref.update({ sent: true, sentAt: admin.firestore.FieldValue.serverTimestamp() });
        processed.push({ id: reminderDoc.id, userId, success: true });
      }
    }

    return res.status(200).json({ success: true, processedCount: processed.length, processed });
  } catch (error: any) {
    console.error("sendReminders API failed", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
