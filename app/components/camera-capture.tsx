'use client';

import { Button, Toast } from '@/app/components/ui';
import { useEffect, useRef, useState } from 'react';

interface CameraCaptureProps {
  label: string;
  facingMode?: 'user' | 'environment';
  allowFileFallback?: boolean;
  onCapture: (file: File) => void;
}

export default function CameraCapture({ label, facingMode = 'user', allowFileFallback = true, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);
  const startingRef = useRef(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsStreaming(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const startCamera = async () => {
    if (startingRef.current) return;
    setErrorMessage('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage(allowFileFallback
        ? 'A câmera não está disponível neste navegador. Use o seletor de arquivo.'
        : 'A câmera não está disponível neste navegador. Abra o ExtraChef em um navegador com acesso à câmera.');
      return;
    }

    startingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (mountedRef.current) setIsStreaming(true);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (mountedRef.current) setErrorMessage('Não foi possível abrir a câmera. Confira a permissão do navegador.');
    } finally { startingRef.current = false; }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setErrorMessage('A câmera ainda está iniciando. Tente novamente.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setErrorMessage('Não foi possível processar a foto.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!mountedRef.current) return;
      if (!blob) {
        setErrorMessage('Não foi possível salvar a foto.');
        return;
      }
      onCapture(new File([blob], `extrachef-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      stopCamera();
    }, 'image/jpeg', 0.88);
  };

  return (
    <div className="space-y-3">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`${isStreaming ? 'block' : 'hidden'} aspect-[3/4] max-h-96 w-full rounded-xl bg-gray-950 object-cover`}
      />
      {errorMessage && <Toast tone="error">{errorMessage}</Toast>}
      {isStreaming ? (
        <div className="flex gap-3">
          <Button variant="primary" type="button" onClick={capturePhoto} className="flex-1 px-4 text-sm">Capturar {label.toLowerCase()}</Button>
          <Button type="button" onClick={stopCamera} className="min-h-12 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700">Cancelar</Button>
        </div>
      ) : (
        <Button type="button" onClick={() => void startCamera()} className="min-h-12 w-full rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-800 transition hover:bg-gray-50">
          Abrir câmera: {label}
        </Button>
      )}
    </div>
  );
}