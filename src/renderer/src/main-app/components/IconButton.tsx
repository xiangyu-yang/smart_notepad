import React from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'solid' | 'soft';
  size?: 'sm' | 'md' | 'lg';
}

const variantClass: Record<NonNullable<IconButtonProps['variant']>, string> = {
  ghost:
    'text-ink-500 hover:text-ink-900 hover:bg-paper-100 active:bg-paper-200',
  soft:
    'text-ink-700 bg-paper-100 hover:bg-paper-200 active:bg-paper-300/70',
  solid:
    'text-white bg-sage-500 hover:bg-sage-600 active:bg-sage-700 shadow-card'
};

const sizeClass: Record<NonNullable<IconButtonProps['size']>, string> = {
  sm: 'w-7 h-7 text-sm rounded-lg',
  md: 'w-9 h-9 text-base rounded-xl',
  lg: 'w-11 h-11 text-lg rounded-xl2'
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size = 'md', className = '', children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        {...rest}
        className={[
          'no-drag inline-flex items-center justify-center',
          'transition-all duration-150 ease-out',
          'hover:scale-[1.03] active:scale-[0.98]',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100',
          variantClass[variant],
          sizeClass[size],
          className
        ].join(' ')}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';

export default IconButton;
