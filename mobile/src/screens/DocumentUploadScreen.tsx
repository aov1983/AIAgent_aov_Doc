import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { documentService } from '../services/api';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';

type DocumentUploadScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'DocumentUpload'>;
};

export default function DocumentUploadScreen({ navigation }: DocumentUploadScreenProps) {
  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setSelectedFile({
          name: file.name || 'unknown',
          uri: file.uri,
        });
      }
    } catch (error: any) {
      Alert.alert('Ошибка', 'Не удалось выбрать файл: ' + error.message);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      Alert.alert('Ошибка', 'Выберите файл для загрузки');
      return;
    }

    setUploading(true);
    setProgress('Загрузка файла...');
    
    try {
      const response = await documentService.uploadDocument(selectedFile.uri, selectedFile.name);
      setProgress('Анализ документа...');
      
      // Имитация задержки анализа
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setProgress('Поиск в базе знаний (RAG)...');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      Alert.alert(
        'Успешно!',
        `Документ "${selectedFile.name}" обработан.\nID: ${response.documentId}`,
        [
          {
            text: 'Просмотреть результаты',
            onPress: () => navigation.navigate('AnalysisResults', { 
              documentId: response.documentId, 
              report: response 
            }),
          },
          {
            text: 'OK',
            onPress: () => {
              setSelectedFile(null);
              setProgress('');
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        'Ошибка загрузки',
        error.response?.data?.detail || 'Не удалось загрузить документ'
      );
    } finally {
      setUploading(false);
      setProgress('');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Загрузка документа</Text>
        <Text style={styles.description}>
          Загрузите документ (DOCX, PDF, TXT) для автоматического анализа требований,
          декомпозиции и поиска похожих решений в базе знаний.
        </Text>

        <TouchableOpacity style={styles.uploadArea} onPress={pickDocument} disabled={uploading}>
          <Text style={styles.uploadIcon}>📁</Text>
          <Text style={styles.uploadText}>
            {selectedFile ? selectedFile.name : 'Нажмите для выбора файла'}
          </Text>
          {selectedFile && (
            <Text style={styles.fileSize}>Файл выбран</Text>
          )}
        </TouchableOpacity>

        {uploading && (
          <View style={styles.progressContainer}>
            <ActivityIndicator size="large" color="#6200EE" />
            <Text style={styles.progressText}>{progress}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.uploadButton, (!selectedFile || uploading) && styles.uploadButtonDisabled]}
          onPress={handleUpload}
          disabled={!selectedFile || uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.uploadButtonText}>Загрузить и анализировать</Text>
          )}
        </TouchableOpacity>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Поддерживаемые форматы:</Text>
          <Text style={styles.infoItem}>• Microsoft Word (.docx, .doc)</Text>
          <Text style={styles.infoItem}>• PDF (.pdf)</Text>
          <Text style={styles.infoItem}>• Текст (.txt)</Text>
          <Text style={styles.infoDescription}>
            \nАгент выполнит декомпозицию на атомарные требования,
            классифицирует исполнителей и найдет похожие решения в RAG.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 24,
  },
  uploadArea: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#6200EE',
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  uploadIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  uploadText: {
    fontSize: 16,
    color: '#6200EE',
    textAlign: 'center',
    fontWeight: '500',
  },
  fileSize: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  progressContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  progressText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  uploadButton: {
    backgroundColor: '#6200EE',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  uploadButtonDisabled: {
    backgroundColor: '#ccc',
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  infoBox: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  infoItem: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  infoDescription: {
    fontSize: 13,
    color: '#888',
    marginTop: 8,
    lineHeight: 18,
  },
});
