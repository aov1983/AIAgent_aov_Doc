import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';

type AnalysisResultsScreenProps = {
  route: RouteProp<RootStackParamList, 'AnalysisResults'>;
  navigation: NativeStackNavigationProp<RootStackParamList, 'AnalysisResults'>;
};

export default function AnalysisResultsScreen({ route, navigation }: AnalysisResultsScreenProps) {
  const { documentId, report } = route.params;

  // Mock data для демонстрации (в реальности данные приходят из API)
  const mockReport = {
    chapters: [
      {
        title: '1. Общие требования',
        sections: [
          {
            title: '1.1. Функциональные требования',
            atoms: [
              {
                paragraph: 'Система должна поддерживать авторизацию пользователей по ролям.',
                fact: 'Требуется система ролевой авторизации.',
                risk: 'Риск несанкционированного доступа при слабой реализации.',
                criticality: 'Высокий',
                recommendation: 'Использовать OAuth 2.0 или JWT токены с refresh механизмом.',
                executor: 'Архитектор, Разработчик',
                similarities: [
                  { id: 'REQ-2023-045', similarity: 87, source: 'Проект "Банк-Клиент"' },
                  { id: 'REQ-2022-112', similarity: 65, source: 'Проект "CRM Система"' },
                ],
                contradictions: [],
              },
              {
                paragraph: 'Время отклика системы не должно превышать 2 секунд.',
                fact: 'Требование к производительности: < 2 сек.',
                risk: 'Риск нарушения SLA при высокой нагрузке.',
                criticality: 'Средний',
                recommendation: 'Внедрить кэширование и оптимизировать запросы к БД.',
                executor: 'DevOps, Разработчик',
                similarities: [
                  { id: 'REQ-2023-078', similarity: 92, source: 'Проект "Маркетплейс"' },
                ],
                contradictions: [],
              },
            ],
          },
        ],
      },
    ],
  };

  const reportData = report?.report || mockReport;

  const getCriticalityColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'высокий': return '#ff5252';
      case 'средний': return '#ff9800';
      case 'низкий': return '#4caf50';
      default: return '#9e9e9e';
    }
  };

  const getSimilarityColor = (percent: number) => {
    if (percent >= 80) return '#4caf50';
    if (percent >= 50) return '#ff9800';
    return '#ff5252';
  };

  const openInRag = (reqId: string) => {
    Alert.alert('Переход в RAG', `Открытие требования ${reqId} в базе знаний`);
    // TODO: Navigate to RAG view or open webview
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.documentId}>ID: {documentId}</Text>
        <Text style={styles.title}>Результаты анализа</Text>
      </View>

      {reportData.chapters?.map((chapter: any, chIndex: number) => (
        <View key={chIndex} style={styles.chapter}>
          <Text style={styles.chapterTitle}>{chapter.title}</Text>
          
          {chapter.sections?.map((section: any, sIndex: number) => (
            <View key={sIndex} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              
              {section.atoms?.map((atom: any, aIndex: number) => (
                <View key={aIndex} style={styles.atomCard}>
                  <View style={styles.atomHeader}>
                    <Text style={styles.atomParagraph}>{atom.paragraph}</Text>
                  </View>

                  <View style={styles.atomContent}>
                    <View style={styles.infoRow}>
                      <Text style={styles.label}>📌 Факт:</Text>
                      <Text style={styles.value}>{atom.fact}</Text>
                    </View>

                    <View style={styles.infoRow}>
                      <Text style={styles.label}>⚠️ Риск:</Text>
                      <Text style={styles.value}>{atom.risk}</Text>
                    </View>

                    <View style={styles.criticalityBadge}>
                      <Text style={styles.criticalityText}>Критичность: {atom.criticality}</Text>
                      <View 
                        style={[
                          styles.criticalityDot, 
                          { backgroundColor: getCriticalityColor(atom.criticality) }
                        ]} 
                      />
                    </View>

                    <View style={styles.infoRow}>
                      <Text style={styles.label}>💡 Рекомендация:</Text>
                      <Text style={styles.value}>{atom.recommendation}</Text>
                    </View>

                    <View style={styles.infoRow}>
                      <Text style={styles.label}>👤 Исполнитель:</Text>
                      <Text style={styles.value}>{atom.executor}</Text>
                    </View>

                    {atom.similarities && atom.similarities.length > 0 && (
                      <View style={styles.similaritiesSection}>
                        <Text style={styles.similaritiesTitle}>🔍 Найденные похожие требования:</Text>
                        {atom.similarities.map((sim: any, simIndex: number) => (
                          <TouchableOpacity 
                            key={simIndex} 
                            style={styles.similarityItem}
                            onPress={() => openInRag(sim.id)}
                          >
                            <View style={styles.similarityHeader}>
                              <Text style={styles.similarityId}>{sim.id}</Text>
                              <View 
                                style={[
                                  styles.similarityBadge, 
                                  { backgroundColor: getSimilarityColor(sim.similarity) }
                                ]}
                              >
                                <Text style={styles.similarityPercent}>{sim.similarity}%</Text>
                              </View>
                            </View>
                            <Text style={styles.similaritySource}>{sim.source}</Text>
                            <Text style={styles.tapHint}>Нажмите для просмотра в RAG →</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {atom.contradictions && atom.contradictions.length > 0 && (
                      <View style={styles.contradictionsSection}>
                        <Text style={styles.contradictionsTitle}>❌ Противоречия:</Text>
                        {atom.contradictions.map((contr: any, cIndex: number) => (
                          <View key={cIndex} style={styles.contradictionItem}>
                            <Text style={styles.contradictionText}>{contr.description}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      ))}

      <TouchableOpacity 
        style={styles.backButton} 
        onPress={() => navigation.navigate('Home')}
      >
        <Text style={styles.backButtonText}>Вернуться на главную</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#6200EE',
    padding: 20,
    paddingTop: 40,
  },
  documentId: {
    color: '#e0e0e0',
    fontSize: 12,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 4,
  },
  chapter: {
    margin: 16,
    marginBottom: 8,
  },
  chapterTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
    marginLeft: 8,
  },
  atomCard: {
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
  atomHeader: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  atomParagraph: {
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
    fontStyle: 'italic',
  },
  atomContent: {
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
    width: 110,
    flexShrink: 0,
  },
  value: {
    fontSize: 13,
    color: '#555',
    flex: 1,
    lineHeight: 18,
  },
  criticalityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  criticalityText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  criticalityDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: 8,
  },
  similaritiesSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  similaritiesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  similarityItem: {
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  similarityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  similarityId: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#6200EE',
  },
  similarityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  similarityPercent: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  similaritySource: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  tapHint: {
    fontSize: 11,
    color: '#999',
    fontStyle: 'italic',
  },
  contradictionsSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#ffeeba',
  },
  contradictionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#d32f2f',
    marginBottom: 8,
  },
  contradictionItem: {
    backgroundColor: '#ffebee',
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  contradictionText: {
    fontSize: 13,
    color: '#c62828',
  },
  backButton: {
    margin: 16,
    padding: 16,
    backgroundColor: '#6200EE',
    borderRadius: 8,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

// Import Alert for demo
import { Alert } from 'react-native';
