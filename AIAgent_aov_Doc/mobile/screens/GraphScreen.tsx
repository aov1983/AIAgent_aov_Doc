import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function GraphScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>🕸 Визуализация графа знаний</Text>
      <Text style={styles.subtext}>Узлы: Главы, Разделы, Абзацы, Чанки</Text>
      <Text style={styles.subtext}>Связи: Иерархия, Похожесть, Противоречия</Text>
      {/* Здесь будет интеграция с библиотекой визуализации графов */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  text: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  subtext: { fontSize: 14, color: '#666' }
});
