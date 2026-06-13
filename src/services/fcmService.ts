import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import app from "../lib/firebase";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  } catch (error) {
    console.warn("FCM permission request failed", error);
    return false;
  }
}

export async function registerFirebaseMessagingServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    return await navigator.serviceWorker.register("/firebase-messaging-sw.js", { type: "module" });
  } catch (error) {
    console.warn("FCM service worker registration failed", error);
    return null;
  }
}

export async function getFcmToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  try {
    const supported = await isSupported();
    if (!supported) {
      return null;
    }

    const registration = await registerFirebaseMessagingServiceWorker();
    const messaging = getMessaging(app);

    if (!VAPID_KEY) {
      console.warn("VITE_FIREBASE_VAPID_KEY is not configured");
      return null;
    }

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration || undefined,
    });

    return token || null;
  } catch (error) {
    console.warn("Unable to fetch FCM token", error);
    return null;
  }
}

export async function listenForForegroundMessages(callback: (payload: any) => void) {
  if (typeof window === "undefined") return;

  try {
    const supported = await isSupported();
    if (!supported) return;

    const messaging = getMessaging(app);
    onMessage(messaging, (payload) => {
      callback(payload);
    });
  } catch (error) {
    console.warn("Foreground FCM listener failed", error);
  }
}
