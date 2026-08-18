# AlgoriMed

### Explainable Clinical Decision Support System

**AlgoriMed AI** is a protocol-driven **Clinical Decision Support System (CDSS)** designed to support clinical decision-making in acute neurological care.

The system combines **evidence-based clinical protocols, a deterministic clinical reasoning engine, and Explainable AI (XAI)** to provide transparent and traceable clinical recommendations.

## 🧠 Core Focus

The primary module focuses on **Traumatic Brain Injury (TBI)** and integrates:

* **Canadian CT Head Rule (CCHR)**
* **Glasgow Coma Scale (GCS)**
* **Brain Trauma Foundation (BTF)**
* **NICE guidelines**
* Clinical risk factors and comorbidities

The platform evaluates patient data against established clinical rules and explains **why** a particular recommendation was generated.

## 🔍 Key Features

* 🧠 Structured clinical reasoning engine
* 🔎 Explainable AI (XAI)
* 📚 Evidence-based clinical protocols
* 🚨 Clinical risk alerts
* 📊 Patient assessment and case history
* 📄 PDF report generation
* 🧩 Modular architecture for additional clinical specialties

## 📊 Pilot Results

* **100 retrospective clinical cases**
* **93.1% clinical concordance**
* No reported platform errors in evaluated cases **44–101**

> These are development-stage pilot results and do not represent definitive clinical validation.

## 🏗️ Architecture

```text
Patient Data
     ↓
Clinical Rules
     ↓
Reasoning Engine
     ↓
XAI / Evidence
     ↓
Clinical Decision Support
```

## 🩺 Current & Planned Modules

* **TBI** — Traumatic Brain Injury
* **Stroke** — development
* **Spine** — NEXUS, Canadian C-Spine Rule, ASIA, ATLS

## 🛠️ Technology

* TypeScript
* Next.js
* React
* Node.js
* GitHub

## ⚠️ Disclaimer

AlgoriMed AI is a **research and development project**. It is designed to support, not replace, professional clinical judgment. The system should not be used as the sole basis for diagnosis or treatment.

---

### AlgoriMed AI

**Evidence → Clinical Rules → Explainable Reasoning → Decision Support**

