self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  const notificationTitle = payload.notification?.title || payload.title || "LifeSync AI";
  const notificationOptions = {
    body: payload.notification?.body || payload.body || "You have a new notification.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: payload.data || payload || {},
  };

  event.waitUntil(self.registration.showNotification(notificationTitle, notificationOptions));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const client = clientList.find((c) => c.url.includes("/") && "focus" in c);
      if (client) {
        return client.focus();
      }
      return clients.openWindow("/");
    })
  );
});
