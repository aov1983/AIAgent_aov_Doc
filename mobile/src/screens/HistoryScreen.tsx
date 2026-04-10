import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { documentService, DocumentHistoryItem } from '../services/api';

type HistoryScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'History'>;
};

export default function HistoryScreen({ navigation }: HistoryScreenProps) {
  const [history, setHistory] = useState<DocumentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = async () => {
    try {
      const data = await documentService.getHistory();
      setHistory(data);
    } catch (error) {
      console.error('Failed to load history:', error);
      // Mock data for demo
      setHistory([
        {
          id: 'doc-001',
          filename: 'Требования_проект_Альфа.docx',
          uploadDate: '2024-01-15T10:30:00Z',
          status: 'completed',
          similarityScore: 87,
        },
        {
          id: 'doc-002',
          filename: 'Спецификация_API_v2.pdf',
          uploadDate: '2024-01-14T15:45:00Z',
          status: 'completed',
          similarityScore: 65,
        },
        {
          id: 'doc-003',
          filename: 'Архитектура_системы.txt',
          uploadDate: '2024-01-13T09:15:00Z',
          status: 'processing',
        },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadHistory();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#4caf50';
      case 'processing': return '#ff9800';
      case 'failed': return '#ff5252';
      default: return '#9e9e9e';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return 'Завершен';
      case 'processing': return 'В обработке';
      case 'failed': return 'Ошибка';
      default: return status;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getSimilarityBadge = (score?: number) => {
    if (score === undefined) return null;
    
    let color = '#ff5252';
    let text = 'Низкое';
    
    if (score >= 80) {
      color = '#4caf50';
      text = 'Высокое';
    } else if (score >= 50) {
      color = '#ff9800';
      text = 'Среднее';
    }

    return (
      <View style={[styles.similarityBadge, { backgroundColor: color }]}>
        <Text style={styles.similarityText}>{text}: {score}%</Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: DocumentHistoryItem }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        if (item.status === 'completed') {
          navigation.navigate('AnalysisResults', {
            documentId: item.id,
            report: { filename: item.filename },
          });
        }
      }}
      disabled={item.status !== 'completed'}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.filename} numberOfLines={2}>
          {item.filename}
        </Text>
        <View 
          style={[
            styles.statusBadge, 
            { backgroundColor: getStatusColor(item.status) }
          ]}
        >
          <Text style={styles.statusText}>
            {getStatusText(item.status)}
          </Text>
        </View>
      </View>

      <View style={styles.cardContent}>
        <View style={styles.infoRow}>
          <Text style={styles.label}>📅 Дата загрузки:</Text>
          <Text style={styles.value}>{formatDate(item.uploadDate)}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>🆔 ID документа:</Text>
          <Text style={styles.value}>{item.id}</Text>
        </View>

        {getSimilarityBadge(item.similarityScore)}
      </View>

      {item.status === 'completed' && (
        <View style={styles.footer}>
          <Text style={styles.viewResults}>Нажмите для просмотра результатов →</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6200EE" />
        <Text style={styles.loadingText}>Загрузка истории...</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={history}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      style={styles.container}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={['#6200EE']}
          tintColor="#6200EE"
        />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📚</Text>
          <Text style={styles.emptyText}>История пуста</Text>
          <Text style={styles.emptySubtext}>
            Загрузите первый документ для анализа
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  listContent: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  filename: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginRight: 12,
    lineHeight: 22,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cardContent: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6200EE',
    width: 120,
    flexShrink: 0,
  },
  value: {
    fontSize: 13,
    color: '#555',
    flex: 1,
  },
  similarityBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 8,
  },
  similarityText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  footer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  viewResults: {
    fontSize: 13,
    color: '#6200EE',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});
