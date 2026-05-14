import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

export default function DocumentDetailScreen({ route }: any) {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Результаты анализа</Text>
      <View style={styles.section}>
        <Text style={styles.label}>Факты:</Text>
        <Text>• Система должна поддерживать нагрузку 1000 RPS</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>Риски:</Text>
        <Text style={{color: 'red'}}>• Высокий риск отказа БД при пиковых нагрузках</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>Похожие требования (RAG):</Text>
        <Text>• Требуется из проекта "Alpha" (Совпадение 85%)</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 15 },
  header: { fontSize: 22, fontWeight: 'bold', marginBottom: 20 },
  section: { marginBottom: 20, backgroundColor: 'white', padding: 15, borderRadius: 8 },
  label: { fontWeight: 'bold', marginBottom: 5 }
});
