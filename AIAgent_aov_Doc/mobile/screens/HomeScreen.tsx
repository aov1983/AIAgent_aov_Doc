import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';

const MOCK_DOCS = [
  { id: '1', title: 'Требования к системе А', date: '2023-10-01', status: 'Analyzed' },
  { id: '2', title: 'Архитектура БД', date: '2023-10-05', status: 'Processing' },
];

export default function HomeScreen({ navigation }: any) {
  return (
    <View style={styles.container}>
      <FlatList
        data={MOCK_DOCS}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Detail', { id: item.id })}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.date}>{item.date}</Text>
            <Text style={styles.status}>{item.status}</Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.fab} onPress={() => Alert.alert('Загрузка', 'Открытие камеры/файлов')}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 15, backgroundColor: '#f5f5f5' },
  card: { backgroundColor: 'white', padding: 15, borderRadius: 8, marginBottom: 10, elevation: 2 },
  title: { fontSize: 16, fontWeight: 'bold' },
  date: { color: '#666', fontSize: 12 },
  status: { color: '#007AFF', fontSize: 12, marginTop: 5 },
  fab: { position: 'absolute', right: 20, bottom: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center' },
  fabText: { color: 'white', fontSize: 30 }
});
