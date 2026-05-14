import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import api from '../services/api';

export default function GraphScreen({ route }: any) {
  const [graph, setGraph] = useState<any>(null);

  useEffect(() => {
    // Загрузка графа
    // api.getGraph(route.params?.docId).then(setGraph);
  }, []);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Граф знаний</Text>
      {graph ? (
        <View>
          <Text>Узлов: {graph.nodes.length}</Text>
          <Text>Связей: {graph.edges.length}</Text>
          {/* Здесь должна быть визуализация графа */}
          <Text>Визуализация графа...</Text>
        </View>
      ) : (
        <Text>Загрузка графа...</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 20 }
});
