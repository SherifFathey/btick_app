import { useState, useEffect } from "react";

export interface ResponsiveLayout {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouch: boolean;
  orientation: "portrait" | "landscape";
  width: number;
  height: number;
}

const getResponsiveState = (): ResponsiveLayout => {
  if (typeof window === "undefined") {
    return {
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isTouch: false,
      orientation: "landscape",
      width: 1920,
      height: 1080,
    };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const isTouch =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches;

  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1024;
  const isDesktop = width >= 1024;
  const orientation = width >= height ? "landscape" : "portrait";

  return {
    isMobile,
    isTablet,
    isDesktop,
    isTouch,
    orientation,
    width,
    height,
  };
};

export function useResponsiveLayout(): ResponsiveLayout {
  const [layout, setLayout] = useState<ResponsiveLayout>(getResponsiveState);

  useEffect(() => {
    let timeoutId: any = null;

    const handleResize = () => {
      // Debounce slightly to prevent layout thrashing on orientation change
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setLayout(getResponsiveState());
      }, 50);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  return layout;
}
