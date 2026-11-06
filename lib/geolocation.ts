export interface DeviceCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  isMock: boolean;
}

export function getDeviceCoordinates(): Promise<DeviceCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Ative sua localização para registrar presença.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const deviceCoords = coords as GeolocationCoordinates & { isMock?: boolean };
        resolve({
          latitude: deviceCoords.latitude,
          longitude: deviceCoords.longitude,
          accuracy: deviceCoords.accuracy,
          speed: deviceCoords.speed,
          isMock: deviceCoords.isMock === true,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error('Ative sua localização para registrar presença.'));
        } else if (error.code === error.TIMEOUT) {
          reject(new Error('Aguardando uma localização mais precisa. Tente novamente em alguns segundos.'));
        } else {
          reject(new Error('Aguardando uma localização mais precisa. Tente novamente em alguns segundos.'));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}