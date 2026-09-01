import { useState, useRef, useCallback, useEffect } from 'react';

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export interface UseMeetingRecorderReturn {
  status: RecorderStatus;
  /** 已录制时长（秒），暂停时不增长 */
  duration: number;
  error: string | null;
  /** 开始录音：请求麦克风权限并启动采集 */
  start: () => Promise<void>;
  /** 停止录音并返回 WAV Blob；若未在录音则返回 null */
  stop: () => Promise<Blob | null>;
  /** 暂停录音 */
  pause: () => void;
  /** 恢复录音 */
  resume: () => void;
  /** 重置到 idle 状态，释放全部资源 */
  reset: () => void;
}

/**
 * WAV 文件头（44 字节）编码为 ArrayBuffer。
 * 16-bit PCM，单声道，采样率与 AudioContext 一致。
 */
function encodeWavHeader(
  dataLength: number,
  sampleRate: number,
  numChannels: number
): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  return buffer;
}

/**
 * 将 Float32Array PCM 数据（-1.0 ~ 1.0）转为 16-bit PCM ArrayBuffer。
 */
function float32ToInt16Pcm(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/**
 * 会议录音 hook —— 基于 AudioContext + ScriptProcessor 直接采集 PCM 数据，
 * 在渲染进程内编码为标准 WAV 文件。
 *
 * 设计要点：
 * - 不依赖 MediaRecorder，避免 webm/opus 容器对 whisper.cpp 的兼容性问题
 * - 输出 16-bit PCM WAV，单声道，采样率与 AudioContext 一致（通常 48000Hz）
 * - whisper.cpp 原生支持 WAV 格式，无需 FFmpeg
 * - 暂停/恢复时正确累计已录时长
 * - 组件卸载时自动停止录音并释放 AudioStream
 *
 * 性能说明：
 * - ScriptProcessor 已被标记 deprecated，但仍是 Electron/Chromium 中最稳定的
 *   同步 PCM 采集方案；AudioWorklet 在 Electron 沙箱中有兼容性问题
 * - 缓冲区大小 4096，单声道 48kHz，每秒约 12 次回调，CPU 开销可忽略
 */
export function useMeetingRecorder(): UseMeetingRecorderReturn {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const sampleRateRef = useRef<number>(48000);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  /** 暂停前已累计的秒数，恢复后在此基础上继续 */
  const elapsedBeforePauseRef = useRef<number>(0);
  /** 暂停标志：onaudioprocess 回调中检查，暂停时跳过数据采集 */
  const pausedRef = useRef<boolean>(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const disconnectNodes = useCallback(() => {
    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null;
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // 忽略：节点可能已自动断开
      }
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // 忽略
      }
      sourceNodeRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTimer();
    disconnectNodes();
    stopStream();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {
        // 忽略关闭错误
      });
    }
    audioContextRef.current = null;
    chunksRef.current = [];
  }, [clearTimer, disconnectNodes, stopStream]);

  // 组件卸载时释放资源
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed =
        Math.floor((Date.now() - startTimeRef.current) / 1000) +
        elapsedBeforePauseRef.current;
      setDuration(elapsed);
    }, 1000);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setDuration(0);
    elapsedBeforePauseRef.current = 0;
    pausedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 单声道，降低数据量与转写负担
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
      chunksRef.current = [];

      // 使用浏览器默认采样率（通常 48000Hz），whisper.cpp 内部会重采样到 16kHz
      const AudioContextCtor: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
      sampleRateRef.current = audioContext.sampleRate;

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // buffer size 必须是 256/512/1024/2048/4096/8192/16384 之一
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorNodeRef.current = processor;

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (pausedRef.current) return;
        const input = e.inputBuffer.getChannelData(0);
        // 复制一份数据，避免 Float32Array 引用被复用
        const copy = new Float32Array(input.length);
        copy.set(input);
        const pcmBuffer = float32ToInt16Pcm(copy);
        chunksRef.current.push(pcmBuffer);
      };

      source.connect(processor);
      // ScriptProcessor 必须连接到 destination 才会触发 onaudioprocess
      // 但我们不希望听到自己的声音，所以连接到 gain=0 的 GainNode
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;
      processor.connect(muteGain);
      muteGain.connect(audioContext.destination);

      setStatus('recording');
      startTimer();
    } catch (err) {
      let message = '无法访问麦克风';
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          message = '麦克风权限被拒绝，请在系统设置中授权';
        } else if (err.name === 'NotFoundError') {
          message = '未检测到麦克风设备';
        } else if (err.name === 'NotReadableError') {
          message = '麦克风被其他应用占用';
        } else {
          message = `麦克风错误：${err.message}`;
        }
      } else if (err instanceof Error) {
        message = err.message;
      }
      setError(message);
      cleanup();
    }
  }, [cleanup, startTimer]);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const context = audioContextRef.current;
      const chunks = chunksRef.current;
      if (!context || chunks.length === 0) {
        clearTimer();
        stopStream();
        disconnectNodes();
        if (context && context.state !== 'closed') {
          context.close().catch(() => {});
        }
        audioContextRef.current = null;
        setStatus('stopped');
        resolve(null);
        return;
      }

      // 合并所有 PCM 块
      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const pcmData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        pcmData.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      // 编码 WAV 文件头 + PCM 数据
      const header = encodeWavHeader(
        totalLength,
        sampleRateRef.current,
        1 // 单声道
      );
      const wavBuffer = new Uint8Array(header.byteLength + totalLength);
      wavBuffer.set(new Uint8Array(header), 0);
      wavBuffer.set(pcmData, header.byteLength);

      const blob = new Blob([wavBuffer], { type: 'audio/wav' });

      clearTimer();
      disconnectNodes();
      stopStream();
      if (context.state !== 'closed') {
        context.close().catch(() => {});
      }
      audioContextRef.current = null;
      chunksRef.current = [];
      setStatus('stopped');
      resolve(blob);
    });
  }, [clearTimer, disconnectNodes, stopStream]);

  const pause = useCallback(() => {
    if (status !== 'recording') return;
    pausedRef.current = true;
    clearTimer();
    elapsedBeforePauseRef.current += Math.floor(
      (Date.now() - startTimeRef.current) / 1000
    );
    setStatus('paused');
  }, [status, clearTimer]);

  const resume = useCallback(() => {
    if (status !== 'paused') return;
    pausedRef.current = false;
    startTimer();
    setStatus('recording');
  }, [status, startTimer]);

  const reset = useCallback(() => {
    cleanup();
    setStatus('idle');
    setDuration(0);
    setError(null);
    elapsedBeforePauseRef.current = 0;
    pausedRef.current = false;
  }, [cleanup]);

  return { status, duration, error, start, stop, pause, resume, reset };
}
