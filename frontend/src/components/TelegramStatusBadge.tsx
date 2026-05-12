"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { readPairing, type TelegramPairing } from "@/lib/telegram/telegram-store";
import TelegramPairingModal from "./TelegramPairingModal";

export default function TelegramStatusBadge() {
  const { currentUser } = useCurrentUser();
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!currentUser) {
      setPairing(null);
      return;
    }
    const p = await readPairing(currentUser);
    setPairing(p);
  }, [currentUser]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!currentUser) return null;

  const paired = !!pairing;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        title={
          paired ? `Paired with @${pairing.botUsername}` : "Connect a Telegram bot to send photos"
        }
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
          paired
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
        }`}
      >
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            paired ? "bg-emerald-500" : "bg-gray-300"
          }`}
        />
        {paired ? `Telegram: @${pairing.botUsername}` : "Connect Telegram"}
      </button>
      {modalOpen && (
        <TelegramPairingModal
          username={currentUser}
          onClose={(updated) => {
            setModalOpen(false);
            if (updated === undefined) return;
            setPairing(updated);
          }}
        />
      )}
    </>
  );
}
