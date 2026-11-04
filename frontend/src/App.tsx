import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AboutPage } from './pages/About'
import { GuardrailsPage } from './pages/Guardrails'
import { HomePage } from './pages/Home'
import { PipelinePage } from './pages/Pipeline'
import { ReviewPage } from './pages/Review'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/guardrails" element={<GuardrailsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
