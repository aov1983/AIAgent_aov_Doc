import streamlit as st

def render_chat_widget(doc_id: str):
    st.markdown(f"### 💬 Чат с документом: `{doc_id}`")
    
    if "chat_messages" not in st.session_state:
        st.session_state.chat_messages = []

    # Отображение истории
    for msg in st.session_state.chat_messages:
        with st.chat_message(msg["role"]):
            st.write(msg["content"])
            if "sources" in msg:
                with st.expander("🔍 Источники"):
                    for src in msg["sources"]:
                        st.info(f"Score: {src.get('score', 0):.2f} | {src.get('text', '')[:100]}...")

    # Поле ввода
    if prompt := st.chat_input("Задайте вопрос по тексту документа..."):
        st.session_state.chat_messages.append({"role": "user", "content": prompt})
        
        # Эмуляция ответа (здесь вызов API)
        response_text = f"Анализирую документ '{doc_id}'... (Здесь будет ответ от ИИ)"
        fake_sources = [{"text": "Найденный чанк из раздела 1.2", "score": 0.88}]
        
        st.session_state.chat_messages.append({
            "role": "assistant", 
            "content": response_text,
            "sources": fake_sources
        })
        st.rerun()
