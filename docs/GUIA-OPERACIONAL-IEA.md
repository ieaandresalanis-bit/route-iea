# IEA Growth Intelligence — Guia Operacional

## Sistema Comercial Unico | Abril 2026

---

## 1. OBJETIVO

Este sistema es la **UNICA** herramienta de operacion comercial para Ingenieria Electrica Alanis.
Cada lead, cada interaccion, cada deal se gestiona exclusivamente aqui.

**No hay excepciones.**

---

## 2. EQUIPO OPERACIONAL

| Nombre | Rol | Email | Responsabilidad |
|--------|-----|-------|-----------------|
| Jaime Navarrete | Asesor Comercial | jaime.nav@iealanis.com | Prospeccion y cierre |
| Juan Pablo Pimentel | Asesor Comercial | j.pimentel@iealanis.com | Prospeccion y cierre |
| Brenda Lopez Flores | Asesor Comercial | atencion@iealanis.com | Prospeccion y cierre |
| Jenifer Hernandez | Asesor Comercial | jenifer@iealanis.com | Prospeccion y cierre |
| Mariana Zarate | Asesor Comercial | mariana@iealanis.com | Prospeccion y cierre |
| Andres Alanis | Director Comercial | admin@iea.com | Deals high-value, estrategia |
| Neto | Supervisor | — | Monitoreo, enforcement, reasignacion |

---

## 3. MODULOS DEL SISTEMA

### Uso Diario (Obligatorio)

| Modulo | Ruta | Para que sirve |
|--------|------|----------------|
| Centro de Mando | `/sales/command` | Scoreboard, enforcement, adopcion, reglas |
| Operacion Diaria | `/sales/ops` | Tareas del dia, follow-ups, leads prioritarios |
| Plan de Trabajo | `/sales/plan` | Tareas asignadas por el sistema |
| Motor de Ejecucion | `/sales/execution` | Ejecutar tareas: iniciar, completar, siguiente |
| Alertas | `/sales/alerts` | Problemas detectados automaticamente |

### Vista General

| Modulo | Ruta | Para que sirve |
|--------|------|----------------|
| Panel Comercial | `/sales` | KPIs generales, pipeline, conversion |
| Pipeline | `/sales/pipeline` | Vista por etapas de todos los deals |
| Cierre de Deals | `/sales/deal-closing` | Deals en etapa de cierre |
| Revenue Intelligence | `/sales/revenue` | Forecast, gap analysis, revenue tracking |

### Supervision

| Modulo | Ruta | Para que sirve |
|--------|------|----------------|
| Supervisor (Neto) | `/sales/supervisor` | Control del equipo, alertas, acciones |
| Disciplina | `/sales/discipline` | Score de disciplina por asesor |
| Equipo | `/sales/team` | Estructura, carga, reasignacion |

---

## 4. FLUJO DIARIO OBLIGATORIO

### INICIO DEL DIA (8:00 AM)

1. Abrir `/sales/ops`
2. Revisar tareas asignadas para hoy
3. Identificar leads criticos (high-value, overdue)
4. Planificar secuencia de ejecucion

### DURANTE EL DIA (8:00 AM - 6:00 PM)

1. Ejecutar TODOS los follow-ups programados
2. Actualizar el stage del lead despues de cada interaccion
3. Registrar CADA contacto en el sistema (llamada, WhatsApp, email, visita)
4. Completar tareas asignadas en orden de prioridad
5. Responder a alertas del sistema

### FIN DEL DIA (6:00 PM)

1. Completar todas las tareas high-priority
2. Actualizar pipeline — todos los deals con stage correcto
3. Verificar: cero leads criticos pendientes
4. Revisar tareas para manana

---

## 5. TIPOS DE TAREAS

| Tipo | Icono | Descripcion |
|------|-------|-------------|
| Llamada | telefono | Llamar al lead/cliente |
| WhatsApp | mensaje | Enviar mensaje por WhatsApp |
| Email | correo | Enviar email |
| Follow-up | repetir | Seguimiento a interaccion previa |
| Cierre | acuerdo | Cerrar deal (enviar contrato, cobrar) |
| Reactivacion | bateria | Reactivar lead inactivo |
| Visita | carro | Visita presencial |
| Cotizacion | documento | Enviar cotizacion |
| Escalacion | arriba | Escalar al director |

### Como ejecutar una tarea:

1. Abrir `/sales/execution`
2. Ver tarea asignada con contexto del lead
3. Click "Iniciar"
4. Ejecutar la accion (llamar, enviar WhatsApp, etc.)
5. Click "Completar" con resultado:
   - **Exitoso**: Se logro el objetivo
   - **Parcial**: Hubo avance pero falta mas
   - **Sin respuesta**: No contesto
   - **Reagendado**: Se programo para despues
   - **Fallido**: No se logro, lead no interesado
6. Si hubo avance, actualizar el stage del lead
7. Siguiente tarea

---

## 6. ETAPAS DEL PIPELINE (STAGES)

| Stage | Significado | Accion esperada |
|-------|-------------|-----------------|
| PENDIENTE_CONTACTAR | Lead nuevo, sin contacto | Contactar en 24h |
| INTENTANDO_CONTACTAR | Se intento contactar | Reintentar en 24-48h |
| EN_PROSPECCION | En conversacion activa | Calificar necesidad |
| AGENDAR_CITA | Necesita cita/reunion | Programar reunion |
| ESPERANDO_COTIZACION | Pidio cotizacion | Enviar en 48h max |
| COTIZACION_ENTREGADA | Ya tiene cotizacion | Follow-up en 3 dias |
| ESPERANDO_CONTRATO | Acepto, falta contrato | Enviar contrato inmediatamente |
| PENDIENTE_PAGO | Contrato firmado, falta pago | Cobrar en 7 dias |
| CERRADO_GANADO | Deal cerrado exitosamente | Transicion a post-venta |
| CERRADO_PERDIDO | Deal perdido | Documentar razon |

---

## 7. REGLAS DE ENFORCEMENT (NO NEGOCIABLES)

### OBLIGATORIO:

- Usar el sistema TODOS los dias laborables
- Completar las tareas asignadas por el sistema
- Registrar CADA interaccion con un lead (llamada, WhatsApp, email, visita)
- Actualizar el stage del lead despues de cada avance
- Seguir el plan de follow-ups del sistema
- Responder a alertas criticas en menos de 2 horas

### PROHIBIDO:

- Llevar leads en WhatsApp personal, libretas o notas
- Usar Excel, Google Sheets u otras herramientas paralelas
- No registrar una llamada o interaccion
- Saltarse follow-ups sin justificacion
- Manejar deals fuera de la plataforma
- Ignorar alertas del sistema

### CONSECUENCIA:

El sistema monitorea automaticamente:
- Tareas completadas vs asignadas
- Tiempo de inactividad
- Leads sin contacto reciente
- Deals estancados

Los resultados se reflejan en el **Scoreboard Diario** y el **Score de Disciplina**.

---

## 8. KPIs DIARIOS

Cada asesor es evaluado diariamente en:

| KPI | Meta minima | Descripcion |
|-----|-------------|-------------|
| Follow-ups completados | 10/dia | Seguimientos ejecutados |
| Contactos realizados | 5/dia | Leads con interaccion exitosa |
| Deals movidos | 2/dia | Leads que avanzaron de stage |
| Deals cerrados | - | Cierres exitosos |
| Inactivos reducidos | 3/dia | Leads reactivados |
| Score de ejecucion | 60+ | Calificacion diaria (0-100) |

El **Ranking Diario** se muestra en `/sales/command` (Centro de Mando).

---

## 9. ROL DEL SUPERVISOR (NETO)

### Monitoreo diario:
- Abrir `/sales/alerts` — revisar alertas criticas
- Abrir `/sales/supervisor` — estado del equipo
- Abrir `/sales/command` — scoreboard y enforcement

### Acciones:
- **Detectar inactividad**: Si un asesor lleva >3h sin actividad, contactar
- **Reasignar leads**: Leads estancados pasan a otro asesor
- **Escalar deals**: Deals >$500K sin avance van al director
- **Forzar ejecucion**: Tareas criticas deben completarse ese dia

### Herramientas del supervisor:
- Reasignacion de leads
- Reasignacion masiva
- Escalacion al director
- Forzar accion en tareas

---

## 10. ROL DEL DIRECTOR (ANDRES)

### Diario:
- Revisar `/sales` dashboard — KPIs generales
- Revisar alertas criticas
- Monitorear top 10 deals

### Semanal:
- `/sales/revenue` — Revenue forecast y gap analysis
- `/sales/deal-closing` — Plan de cierre
- `/sales/optimization` — Optimizacion del sistema
- Ajustar estrategia comercial

### Deals high-value:
- Deals >$500K son responsabilidad directa del director
- Escalaciones del supervisor requieren accion en 24h

---

## 11. PLAN SEMANA 1

### Dia 1-2: Onboarding + Primera Ejecucion
- Sesion de entrenamiento (60 min)
- Cada asesor abre `/sales/ops` y revisa sus tareas
- Ejecutar al menos 5 follow-ups por asesor
- Actualizar al menos 3 stages de leads
- Registrar toda interaccion en el sistema

### Dia 3-5: Monitoreo + Correccion
- Verificar que todos los asesores usan el sistema diariamente
- Corregir comportamiento: no hay excusas para no registrar
- Neto monitorea `/sales/alerts` y actua
- Director revisa scoreboard diario
- Meta: 80%+ adoption rate al fin de semana

### Fin de Semana 1: Evaluacion
- Evaluar performance por asesor
- Identificar top performers
- Identificar gaps y corregir
- Ajustar metas para Semana 2

---

## 12. CRITERIOS DE EXITO

El sistema es exitoso cuando:

- [ ] 100% de leads estan rastreados en el sistema
- [ ] 100% de follow-ups estan registrados
- [ ] Cero leads inactivos sin accion planificada
- [ ] Todos los asesores usan el sistema diariamente
- [ ] Visibilidad total de revenue y pipeline
- [ ] El sistema es la UNICA forma de operar

---

## 13. RECORDATORIOS AUTOMATICOS

El sistema envia recordatorios automaticos a las 10:00, 12:00, 14:00 y 16:00 (Lunes a Sabado):

- Tareas vencidas sin completar
- Tareas proximas a vencer (4h)
- Asesores sin actividad del dia
- Alertas criticas sin resolver

---

## OBJETIVO FINAL

**Cada lead: rastreado.**
**Cada accion: ejecutada.**
**Cada oportunidad: cerrada.**

El sistema es la UNICA forma de operar. Sin excepciones.

---

*Documento generado: Abril 2026*
*IEA Growth Intelligence — Ingenieria Electrica Alanis*
