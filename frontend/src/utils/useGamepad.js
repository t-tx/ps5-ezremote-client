import { useEffect, useRef } from 'react';

export const useGamepad = ({ onL1, onR1 }) => {
  const requestRef = useRef();
  const lastState = useRef({ L1: false, R1: false });

  const checkGamepad = () => {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp) {
        // Standard gamepad mapping: L1 is button 4, R1 is button 5
        const currentL1 = gp.buttons[4]?.pressed;
        const currentR1 = gp.buttons[5]?.pressed;

        if (currentL1 && !lastState.current.L1) {
          if (onL1) onL1();
        }
        if (currentR1 && !lastState.current.R1) {
          if (onR1) onR1();
        }

        lastState.current = { L1: currentL1, R1: currentR1 };
        break; // Only check the first connected gamepad
      }
    }
    requestRef.current = requestAnimationFrame(checkGamepad);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(checkGamepad);
    return () => cancelAnimationFrame(requestRef.current);
  }, [onL1, onR1]);
};
