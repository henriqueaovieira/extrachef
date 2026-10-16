export interface DeviceCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export function getDeviceCoordinates(): Promise<DeviceCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Este navegador não oferece acesso à localização.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
      }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error('Permita o acesso à localização para utilizar este recurso.'));
        } else if (error.code === error.TIMEOUT) {
          reject(new Error('Não foi possível obter sua localização a tempo. Tente novamente.'));
        } else {
          reject(new Error('Não foi possível obter sua localização. Verifique o GPS e tente novamente.'));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}