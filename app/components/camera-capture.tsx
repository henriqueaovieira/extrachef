'use client';

import { useEffect, useRef, useState } from 'react';

interface CameraCaptureProps {
  label: string;
  facingMode?: 'user' | 'environment';
  onCapture: (file: File) => void;
}

export default function CameraCapture({ label, facingMode = 'user', onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsStreaming(false);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const startCamera = async () => {
    setErrorMessage('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('A câmera não está disponível neste navegador. Use o seletor de arquivo.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsStreaming(true);
    } catch {
      setErrorMessage('Não foi possível abrir a câmera. Confira a permissão do navegador.');
    }
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
      {errorMessage && <p role="alert" className="text-sm text-red-700">{errorMessage}</p>}
      {isStreaming ? (
        <div className="flex gap-3">
          <button type="button" onClick={capturePhoto} className="min-h-12 flex-1 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white">Capturar {label.toLowerCase()}</button>
          <button type="button" onClick={stopCamera} className="min-h-12 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700">Cancelar</button>
        </div>
      ) : (
        <button type="button" onClick={() => void startCamera()} className="min-h-12 w-full rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-800 transition hover:bg-gray-50">
          Abrir câmera: {label}
        </button>
      )}
    </div>
  );
}