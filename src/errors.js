// src/errors.js

class PipelineError extends Error {
  constructor(message, stage, cause) {
    super(message);
    this.name = this.constructor.name;
    this.stage = stage; // "topic-source" | "generator" | "verifier" | "publisher"
    this.cause = cause;
    this.retryable = false;
  }
}

class TransientError extends PipelineError {
  constructor(message, stage, cause) {
    super(message, stage, cause);
    this.retryable = true;
  }
}

class TopicSourceError extends PipelineError {
  constructor(message, cause) {
    super(message, 'topic-source', cause);
  }
}

class GenerationError extends PipelineError {
  constructor(message, cause) {
    super(message, 'generator', cause);
  }
}

class TransientGenerationError extends TransientError {
  constructor(message, cause) {
    super(message, 'generator', cause);
  }
}

class VerificationFailed extends PipelineError {
  constructor(message, cause) {
    super(message, 'verifier', cause);
  }
}

class TransientVerificationError extends TransientError {
  constructor(message, cause) {
    super(message, 'verifier', cause);
  }
}

class PublishError extends PipelineError {
  constructor(message, cause) {
    super(message, 'publisher', cause);
  }
}

class TransientPublishError extends TransientError {
  constructor(message, cause) {
    super(message, 'publisher', cause);
  }
}

/**
 * Tebak apakah error dari SDK provider AI/HTTP bersifat transient (layak diretry)
 * berdasarkan status code-nya — 429/5xx atau kegagalan level-jaringan (tidak ada
 * status sama sekali, mis. timeout/DNS) dianggap transient. 4xx lain (auth, bad
 * request) dianggap permanen — retry tidak akan membantu (02-TECH-DESIGN.md §6).
 * @param {any} err
 * @returns {boolean}
 */
function isTransientCause(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode;
  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }
  return true;
}

module.exports = {
  PipelineError,
  TransientError,
  TopicSourceError,
  GenerationError,
  TransientGenerationError,
  VerificationFailed,
  TransientVerificationError,
  PublishError,
  TransientPublishError,
  isTransientCause,
};
