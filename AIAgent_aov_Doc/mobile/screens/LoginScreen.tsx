import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import { authService } from '../services/authService';

export default function LoginScreen({ navigation }: any) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    try {
      await authService.login(login, password);
      navigation.replace('Home');
    } catch (e) {
      Alert.alert('Ошибка', 'Неверный логин или пароль');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AI Architect Agent</Text>
      <TextInput placeholder="Логин" style={styles.input} value={login} onChangeText={setLogin} />
      <TextInput placeholder="Пароль" style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
      <Button title="Войти" onPress={handleLogin} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 10, marginBottom: 15, borderRadius: 5 }
});
