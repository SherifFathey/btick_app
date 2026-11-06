import React, { useEffect, useRef } from "react";
import { MobileAccessCard } from "./MobileAccessCard";

export interface MobileAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  isConnected?: boolean;
}

export const MobileAccessModal: React.FC<MobileAccessModalProps> = ({
  isOpen,
  onClose,
  isConnected,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | PointerEvent | TouchEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handleClickOutside, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handleClickOutside, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in select-text whitespace-normal">
      <div ref={modalRef} className="relative w-full max-w-lg">
        <MobileAccessCard isConnected={isConnected} onClose={onClose} />
      </div>
    </div>
  );
};
