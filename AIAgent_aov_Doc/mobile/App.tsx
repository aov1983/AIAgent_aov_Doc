import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import GraphScreen from './screens/GraphScreen';
import DocumentDetailScreen from './screens/DocumentDetailScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} options={{title: 'Вход в систему'}} />
        <Stack.Screen name="Home" component={HomeScreen} options={{title: 'Мои документы'}} />
        <Stack.Screen name="Graph" component={GraphScreen} options={{title: 'Граф знаний'}} />
        <Stack.Screen name="Detail" component={DocumentDetailScreen} options={{title: 'Анализ'}} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
