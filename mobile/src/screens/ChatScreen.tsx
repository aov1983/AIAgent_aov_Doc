import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
}

export default function ChatScreen({ route }: any) {
  const { docId } = route.params || { docId: 'Unknown Doc' };
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: `Привет! Я готов обсудить документ "${docId}". Что вас интересует?`, sender: 'bot' }
  ]);
  const [input, setInput] = useState('');

  const sendMessage = () => {
    if (!input.trim()) return;
    const newUserMsg: Message = { id: Date.now().toString(), text: input, sender: 'user' };
    setMessages(prev => [...prev, newUserMsg]);
    setInput('');

    setTimeout(() => {
      const newBotMsg: Message = { 
        id: (Date.now()+1).toString(), 
        text: "Это демо-режим. Подключите API для получения реального ответа из RAG.", 
        sender: 'bot' 
      };
      setMessages(prev => [...prev, newBotMsg]);
    }, 1000);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <FlatList
        data={messages}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={[styles.msgBubble, item.sender === 'user' ? styles.userBubble : styles.botBubble]}>
            <Text style={item.sender === 'user' ? styles.userText : styles.botText}>{item.text}</Text>
          </View>
        )}
        style={styles.list}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Введите вопрос..."
          placeholderTextColor="#999"
        />
        <TouchableOpacity onPress={sendMessage} style={styles.sendBtn}>
          <Text style={styles.sendBtnText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  list: { flex: 1, padding: 10 },
  msgBubble: { maxWidth: '80%', padding: 12, borderRadius: 15, marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#007AFF' },
  botBubble: { alignSelf: 'flex-start', backgroundColor: '#E5E5EA' },
  userText: { color: '#fff' },
  botText: { color: '#000' },
  inputContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#fff', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 15, height: 40, marginRight: 10 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center' },
  sendBtnText: { color: '#fff', fontSize: 18 }
});
