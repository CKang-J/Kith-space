/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/image/Image.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { useState, useRef, useEffect, useCallback, useMemo, Fragment, memo } from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { Transition, TransitionChild } from '@headlessui/react';
import { cn } from '@recombyn-native/utils/classnames';
import { Icon } from '@recombyn-native/components/base/icon';
import { Button } from '@recombyn-native/components/base/button';
import PreviewToolbar from './PreviewToolbar';

export interface ImageProps {
  src?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  className?: string;
  imgClassName?: string;
  style?: React.CSSProperties;
  fallback?: string;
  placeholder?: React.ReactNode;
  preview?: boolean | {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** @default true */
    previewOnClick?: boolean;
    mask?: React.ReactNode;
    maskClassName?: string;
  };
  lazy?: boolean;
  /** IntersectionObserver root margin (px) */
  threshold?: number;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const DEFAULT_FALLBACK = 'data:image/png;base64,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';

const Image: React.FC<ImageProps> = ({
  src,
  alt = '',
  width,
  height,
  className,
  imgClassName,
  style,
  fallback = DEFAULT_FALLBACK,
  placeholder,
  preview = true,
  lazy = true,
  threshold = 100,
  onLoad,
  onError,
  onClick,
}) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewImgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(!lazy);
  const [imageSrc, setImageSrc] = useState<string | undefined>(lazy ? undefined : src);
  const [error, setError] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [transform, setTransform] = useState({ rotate: 0, scale: 1, flipX: false, flipY: false });

  const previewConfig = useMemo(() => {
    return typeof preview === 'object' ? preview : { open: previewOpen, onOpenChange: setPreviewOpen };
  }, [preview, previewOpen]);
  const isPreviewEnabled = preview !== false;
  const isControlledPreview = typeof preview === 'object' && preview.open !== undefined;
  const currentPreviewOpen = isControlledPreview ? preview.open! : previewOpen;

  useEffect(() => {
    if (!lazy || loaded || !containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setLoaded(true);
            setImageSrc(src);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: `${threshold}px`,
      }
    );

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [lazy, loaded, src, threshold]);

  /** Keep displayed `src` in sync when `src` changes (lazy: only after in view). */
  useEffect(() => {
    if (!lazy || loaded) {
      setImageSrc(src);
      setError(false);
    }
  }, [src, lazy, loaded]);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setError(false);
    onLoad?.(e);
  }, [onLoad]);

  const handleError = useCallback((e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setError(true);
    setImageSrc(fallback);
    onError?.(e);
  }, [fallback, onError]);

  const previewOnClick = typeof preview === 'object' ? preview.previewOnClick !== false : true;
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isPreviewEnabled && previewOnClick) {
      if (!isControlledPreview) {
        setPreviewOpen(true);
      }
      previewConfig.onOpenChange?.(true);
      setTransform({ rotate: 0, scale: 1, flipX: false, flipY: false });
    }
    onClick?.(e);
  }, [isPreviewEnabled, previewOnClick, isControlledPreview, previewConfig, onClick]);

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isPreviewEnabled || !previewOnClick) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick(e as unknown as React.MouseEvent<HTMLDivElement>);
      }
    },
    [handleClick, isPreviewEnabled, previewOnClick]
  );

  const handlePreviewClose = useCallback(() => {
    if (!isControlledPreview) {
      setPreviewOpen(false);
    }
    previewConfig.onOpenChange?.(false);
  }, [isControlledPreview, previewConfig]);

  const handleAfterLeave = useCallback(() => {
    setTransform({ rotate: 0, scale: 1, flipX: false, flipY: false });
  }, []);

  const handleRotateLeft = useCallback(() => {
    setTransform((prev) => ({ ...prev, rotate: prev.rotate - 90 }));
  }, []);

  const handleRotateRight = useCallback(() => {
    setTransform((prev) => ({ ...prev, rotate: prev.rotate + 90 }));
  }, []);

  const handleFlipX = useCallback(() => {
    setTransform((prev) => ({ ...prev, flipX: !prev.flipX }));
  }, []);

  const handleFlipY = useCallback(() => {
    setTransform((prev) => ({ ...prev, flipY: !prev.flipY }));
  }, []);

  const handleZoomIn = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.min(prev.scale * 1.2, 5) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.max(prev.scale / 1.2, 0.5) }));
  }, []);

  useEffect(() => {
    if (!currentPreviewOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handlePreviewClose();
      }
    };
    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setTransform((prev) => ({
        ...prev,
        scale: Math.max(0.5, Math.min(5, prev.scale + delta)),
      }));
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheelNative, { passive: false, capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheelNative, { capture: true });
    };
  }, [currentPreviewOpen, handlePreviewClose]);


  return (
    <>
      <div
        ref={containerRef}
        className={cn('inline-block', className)}
        style={{ width, height, ...style }}
        onClick={handleClick}
        onKeyDown={handleContainerKeyDown}
        role={isPreviewEnabled && previewOnClick ? 'button' : undefined}
        tabIndex={isPreviewEnabled && previewOnClick ? 0 : undefined}
      >
        {!loaded && placeholder && (
          <div className='flex items-center justify-center w-full h-full'>{placeholder}</div>
        )}
        {loaded && (
          <img
            ref={imgRef}
            src={error ? fallback : imageSrc}
            alt={alt}
            className={cn(
              'max-w-full h-auto',
              isPreviewEnabled && 'cursor-pointer',
              imgClassName
            )}
            onLoad={handleLoad}
            onError={handleError}
            loading={lazy ? 'lazy' : undefined}
          />
        )}
      </div>

      {isPreviewEnabled
        ? createPortal(
          <Transition appear show={currentPreviewOpen} as={Fragment} afterLeave={handleAfterLeave}>
            <div
              className='fixed inset-0 z-[2500]'
              role='dialog'
              aria-modal='true'
              aria-label={alt || 'Image preview'}
              onClick={handlePreviewClose}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handlePreviewClose();
              }}
            >
              <Button
                onClick={handlePreviewClose}
                type='dark'
                shape='circle'
                bordered={false}
                className='absolute right-4 top-4 z-20 !w-10 !h-10 !p-[2px] !bg-black/50 !hover:!bg-black/70'
                aria-label='Close preview'
                icon={<Icon name='base-close-icon' width={16} height={16} color='#ffffff' />}
              />

              <TransitionChild
                enter='duration-0'
                enterFrom='opacity-0'
                enterTo='opacity-100'
                leave='duration-0'
                leaveFrom='opacity-100'
                leaveTo='opacity-0'
              >
                <div className='fixed inset-0 bg-black/50' />
              </TransitionChild>

              <TransitionChild
                enter='duration-0'
                enterFrom='opacity-0 scale-95'
                enterTo='opacity-100 scale-100'
                leave='duration-0'
                leaveFrom='opacity-100 scale-100'
                leaveTo='opacity-0 scale-95'
              >
                <div className='fixed inset-0 flex items-center justify-center overflow-hidden pointer-events-none'>
                  <img
                    ref={previewImgRef}
                    src={error ? fallback : imageSrc || src}
                    alt={alt}
                    className='object-contain block pointer-events-auto'
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      display: 'block',
                      width: 'auto',
                      height: 'auto',
                      maxWidth: 'min(92vw, 960px)',
                      maxHeight: 'min(88vh, 960px)',
                      objectFit: 'contain',
                      transform: `rotate(${transform.rotate}deg) scale(${transform.scale}) scaleX(${transform.flipX ? -1 : 1}) scaleY(${transform.flipY ? -1 : 1})`,
                      transformOrigin: 'center center',
                    }}
                  />
                </div>
              </TransitionChild>

              <PreviewToolbar
                scale={transform.scale}
                onFlipY={handleFlipY}
                onFlipX={handleFlipX}
                onRotateLeft={handleRotateLeft}
                onRotateRight={handleRotateRight}
                onZoomOut={handleZoomOut}
                onZoomIn={handleZoomIn}
              />
            </div>
          </Transition>,
          document.body
        )
        : null}
    </>
  );
};

export default memo(Image);