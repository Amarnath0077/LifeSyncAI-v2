import { useEffect, useState, useCallback } from "react";
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { InAppNotification } from "../types";

export default function useNotifications(userId?: string) {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    const notificationsQuery = query(
      collection(db, "users", userId, "notifications"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      notificationsQuery,
      (snapshot) => {
        const docs = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<InAppNotification, "id">),
        }));
        setNotifications(docs);
        setUnreadCount(docs.filter((item) => !item.read).length);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `users/${userId}/notifications`);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const markAsRead = useCallback(async (notificationId: string) => {
    if (!userId || !notificationId) return;
    try {
      await updateDoc(doc(db, "users", userId, "notifications", notificationId), { read: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}/notifications/${notificationId}`);
    }
  }, [userId]);

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
  };
}
