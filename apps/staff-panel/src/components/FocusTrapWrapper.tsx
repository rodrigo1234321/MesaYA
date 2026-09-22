import React from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface FocusTrapWrapperProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps modal content in a focus-trapped container.
 * Drop-in replacement for a bare <div> around dialog content.
 */
export const FocusTrapWrapper: React.FC<FocusTrapWrapperProps> = ({
  isOpen,
  onClose,
  children,
  className
}) => {
  const ref = useFocusTrap(isOpen, onClose);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
};
