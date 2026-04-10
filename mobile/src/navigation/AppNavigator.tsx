import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import DocumentUploadScreen from './screens/DocumentUploadScreen';
import AnalysisResultsScreen from './screens/AnalysisResultsScreen';
import HistoryScreen from './screens/HistoryScreen';

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  DocumentUpload: undefined;
  AnalysisResults: { documentId: string; report: any };
  History: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator 
        initialRouteName="Login"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#6200EE',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      >
        <Stack.Screen 
          name="Login" 
          component={LoginScreen} 
          options={{ title: 'AI Architect - Вход' }}
        />
        <Stack.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{ title: 'Главная' }}
        />
        <Stack.Screen 
          name="DocumentUpload" 
          component={DocumentUploadScreen} 
          options={{ title: 'Загрузка документа' }}
        />
        <Stack.Screen 
          name="AnalysisResults" 
          component={AnalysisResultsScreen} 
          options={{ title: 'Результаты анализа' }}
        />
        <Stack.Screen 
          name="History" 
          component={HistoryScreen} 
          options={{ title: 'История документов' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
