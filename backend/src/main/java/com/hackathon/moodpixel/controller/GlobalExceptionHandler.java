package com.hackathon.moodpixel.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> validation(MethodArgumentNotValidException ex) {
        String msg = ex.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(e -> e.getDefaultMessage())
                .orElse("参数校验失败");
        return ResponseEntity.badRequest().body(Map.of("error", msg));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, String>> illegalState(IllegalStateException ex) {
        log.warn("业务异常: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", safeMessage(ex)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> other(Exception ex) {
        log.error("未处理异常: {}", ex.toString(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", describe(ex)));
    }

    private static String safeMessage(Throwable ex) {
        String m = ex.getMessage();
        return (m != null && !m.isBlank()) ? m : ex.getClass().getSimpleName();
    }

    /** 许多 JDK 异常（如 InterruptedException）getMessage() 为 null，避免前端只显示泛化文案。 */
    private static String describe(Throwable ex) {
        String m = ex.getMessage();
        if (m != null && !m.isBlank()) {
            return m;
        }
        Throwable c = ex.getCause();
        if (c != null && c.getMessage() != null && !c.getMessage().isBlank()) {
            return ex.getClass().getSimpleName() + ": " + c.getMessage();
        }
        return ex.getClass().getSimpleName() + "（无详细信息，请查看后端控制台日志）";
    }
}
