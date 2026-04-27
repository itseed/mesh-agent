import type { CSSProperties, HTMLAttributes } from 'react'

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  width?: number | string
  height?: number | string
  rounded?: 'sm' | 'md' | 'lg' | 'full' | 'none'
}

const ROUNDED: Record<NonNullable<SkeletonProps['rounded']>, string> = {
  none: 'rounded-none',
  sm: 'rounded',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
}

export function Skeleton({
  width,
  height,
  rounded = 'sm',
  className = '',
  style,
  ...rest
}: SkeletonProps) {
  const merged: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    ...style,
  }
  return (
    <div
      aria-hidden="true"
      className={`skeleton ${ROUNDED[rounded]} ${className}`}
      style={merged}
      {...rest}
    />
  )
}
