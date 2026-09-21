import { Alert } from 'react-native';

export function confirm(title: string, message: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
  ]);
  return promise;
}

export function notify(title: string, message: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  Alert.alert(title, message, [{ text: 'OK', onPress: () => resolve() }]);
  return promise;
}
