import streamlit as st
import json

def render_graph(graph_data: dict):
    """
    Отрисовка графа знаний.
    Отображает узлы (Главы, Разделы, Абзацы, Чанки) и связи между ними.
    """
    st.subheader("🕸 Граф знаний документа")
    
    if not graph_data or 'nodes' not in graph_data:
        st.warning("⚠️ Граф не построен или данные отсутствуют.")
        return

    # Статистика
    stats = graph_data.get('stats', {})
    cols = st.columns(4)
    with cols[0]:
        st.metric("Всего узлов", stats.get('total_nodes', 0))
    with cols[1]:
        st.metric("Связей", stats.get('total_edges', 0))
    with cols[2]:
        st.metric("Абзацев", stats.get('paragraphs', 0))
    with cols[3]:
        st.metric("Чанков", stats.get('chunks', 0))

    st.divider()

    # Визуализация (упрощенная через JSON или таблицу, т.к. pyvis требует доп. настроек)
    st.markdown("### Структура графа")
    
    # Группировка по типам
    nodes_by_type = {}
    for node in graph_data.get('nodes', []):
        n_type = node.get('type', 'unknown')
        if n_type not in nodes_by_type:
            nodes_by_type[n_type] = []
        nodes_by_type[n_type].append(node)

    # Отображение по уровням
    type_order = ['chapter', 'section', 'paragraph', 'chunk']
    
    for t in type_order:
        nodes = nodes_by_type.get(t, [])
        if nodes:
            with st.expander(f"📁 {t.capitalize()}s ({len(nodes)})"):
                for node in nodes:
                    col1, col2 = st.columns([1, 3])
                    with col1:
                        st.code(node.get('label', 'Unknown'))
                    with col2:
                        content = node.get('content', '')
                        if len(content) > 200:
                            content = content[:200] + "..."
                        st.caption(content)
                        
                        # Метаданные
                        meta = node.get('metadata', {})
                        if meta:
                            with st.popover("Метаданные"):
                                st.json(meta)

    st.divider()
    
    # Связи
    st.markdown("### Связи между узлами")
    edges = graph_data.get('edges', [])
    
    similar_edges = [e for e in edges if e.get('type') == 'similar_to']
    conflict_edges = [e for e in edges if e.get('type') == 'conflicts_with']
    
    if similar_edges:
        st.success(f"✅ Найдено семантических связей: {len(similar_edges)}")
        for edge in similar_edges[:5]: # Показываем первые 5
            st.caption(f"🔗 {edge.get('source')} ↔️ {edge.get('target')} (Score: {edge.get('weight', 0):.2f})")
            
    if conflict_edges:
        st.error(f"⚠️ Найдено противоречий: {len(conflict_edges)}")
        for edge in conflict_edges:
            st.caption(f"⚔️ {edge.get('source')} ⚡ {edge.get('target')}")

    # Экспорт
    st.download_button(
        label="📥 Скачать граф (JSON)",
        data=json.dumps(graph_data, ensure_ascii=False, indent=2),
        file_name="knowledge_graph.json",
        mime="application/json"
    )
