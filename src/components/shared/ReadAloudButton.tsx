'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Volume2, Square } from 'lucide-react'

/**
 * Read-aloud button backed by the Web Speech API (window.speechSynthesis) —
 * fully on-device: only voices with localService=true are ever used, so no
 * text leaves the machine. Renders nothing when the API is unavailable.
 */

/** Strip markdown/citation artifacts so they aren't spoken aloud. */
function speakableText(text: string): string {
  return text
    .replace(/\[\d+\]/g, '') // [N] citation markers
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/\*\*([^*]*)\*\*/g, '$1') // bold
    .replace(/\*([^*]*)\*/g, '$1') // italic
    .replace(/^#{1,6}\s+/gm, '') // headers
    .replace(/^\s*[-*•]\s+/gm, '') // bullet prefixes
    .replace(/^[\s|:-]+$/gm, '') // table separator rows
    .replace(/\|/g, ' ') // table pipes
    .replace(/\s+([.,;:!?])/g, '$1') // orphaned punctuation left by stripped markers
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Split into utterance-sized chunks on sentence boundaries (~200 chars max).
 * Chrome silently stalls on long utterances; queueing short ones avoids it.
 */
function chunkText(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]?\s*|[^.!?]+$/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 200) {
      chunks.push(current.trim())
      current = sentence
    } else {
      current += sentence
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

/** Prefer a local English voice; Enhanced/Premium system voices win if downloaded. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  const local = voices.filter(v => v.localService && v.lang.startsWith('en'))
  if (local.length === 0) return null
  return (
    local.find(v => /premium/i.test(v.name)) ??
    local.find(v => /enhanced/i.test(v.name)) ??
    local.find(v => v.default) ??
    local[0]
  )
}

const noopSubscribe = () => () => {}

export default function ReadAloudButton({ text, className = '' }: { text: string; className?: string }) {
  // Hydration-safe capability check: false on the server, real value on the client.
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => 'speechSynthesis' in window,
    () => false
  )
  const [speaking, setSpeaking] = useState(false)
  const sessionRef = useRef(0)
  // True only while this instance owns the current global playback — so
  // unmount doesn't cancel audio another button started later.
  const ownsPlaybackRef = useRef(false)

  useEffect(() => {
    // Chrome populates the voice list lazily; warm it so the first play works.
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices()
    return () => {
      if (ownsPlaybackRef.current) window.speechSynthesis.cancel()
    }
  }, [])

  function stop() {
    sessionRef.current += 1
    ownsPlaybackRef.current = false
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  function play() {
    // The API is a global singleton — cancel whatever else is speaking.
    window.speechSynthesis.cancel()
    const session = ++sessionRef.current
    const chunks = chunkText(speakableText(text))
    if (chunks.length === 0) return
    const voice = pickVoice()

    ownsPlaybackRef.current = true
    setSpeaking(true)
    chunks.forEach((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk)
      if (voice) utterance.voice = voice
      const finish = () => {
        if (session === sessionRef.current) {
          ownsPlaybackRef.current = false
          setSpeaking(false)
        }
      }
      if (i === chunks.length - 1) utterance.onend = finish
      utterance.onerror = finish
      window.speechSynthesis.speak(utterance)
    })
  }

  if (!supported) return null

  return (
    <button
      onClick={speaking ? stop : play}
      title={speaking ? 'Stop reading' : 'Read aloud'}
      className={`p-1 rounded transition-colors ${speaking ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'} ${className}`}
    >
      {speaking ? <Square size={11} /> : <Volume2 size={11} />}
    </button>
  )
}
