import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Button, StyleSheet } from 'react-native';
import api from '../services/api';

export default function HomeScreen({ navigation }: any) {
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    // Загрузка списка документов
    // api.getDocuments().then(setDocs);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Мои документы</Text>
      <Button title="Загрузить новый" onPress={() => navigation.navigate('Upload')} />
      <Button title="Граф знаний" onPress={() => navigation.navigate('Graph')} />
      <FlatList
        data={docs}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text>{item.name}</Text>
            <Text>Статус: {item.status}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  header: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  item: { padding: 15, borderBottomWidth: 1, borderColor: '#eee' }
});
