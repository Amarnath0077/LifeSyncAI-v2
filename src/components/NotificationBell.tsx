import React, { useState } from "react";
import { Bell, CheckCircle2, X } from "lucide-react";
import { InAppNotification } from "../types";

interface NotificationBellProps {
  notifications: InAppNotification[];
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export default function NotificationBell({ notifications, unreadCount, onMarkAsRead, onMarkAllRead }: NotificationBellProps) {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="relative rounded-xl p-2 border transition cursor-pointer bg-slate-100 dark:bg-slate-900 border-slate-200/60 dark:border-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        id="notification-bell-toggle"
      >
        <Bell className="h-4.5 w-4.5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-rose-500 text-[10px] text-white font-bold leading-none px-1.5 py-0.5">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[320px] max-h-[420px] overflow-hidden overflow-y-auto rounded-3xl border border-slate-200/70 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 z-50">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 dark:border-slate-800 px-4 py-3 bg-slate-50 dark:bg-slate-900">
            <div>
              <p className="font-bold text-sm text-slate-900 dark:text-slate-100">Notifications</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Your latest activity updates.</p>
            </div>
            <button
              type="button"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              onClick={() => {
                onMarkAllRead();
              }}
            >
              Mark all read
            </button>
          </div>
          <div className="divide-y divide-slate-200/70 dark:divide-slate-800">
            {notifications.length === 0 ? (
              <div className="p-5 text-center text-sm text-slate-500 dark:text-slate-400">
                No notifications yet.
              </div>
            ) : (
              notifications.slice(0, 12).map((notification) => (
                <div
                  key={notification.id}
                  className={`flex flex-col gap-2 px-4 py-4 transition ${notification.read ? "bg-transparent" : "bg-slate-100 dark:bg-slate-900"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{notification.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{notification.message}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-full p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={() => onMarkAsRead(notification.id)}
                      aria-label={`Mark ${notification.title} as read`}
                    >
                      {notification.read ? <CheckCircle2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{notification.type}</span>
                    <span>{notification.date}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
