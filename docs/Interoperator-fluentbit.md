## Fluent Bit as a Log Forwarder

The Interoperator broker prints logs as multi line for better readability.
These pretty printed JSON logs are treated as separate lines by docker log collector. 

Here is a Fluent Bit configuration to support multi line,
```yaml
  input-interoperator.conf: |
    [INPUT]
        Name              tail
        Tag               kube.*
        Path              /var/log/containers/*_interoperator_*.log
        Parser            docker
        Ignore_Older      2d  
        Mem_Buf_Limit     10MB
        Skip_Long_Lines   On  
        Refresh_Interval  5
        Docker_Mode      On  
        Docker_Mode_Parser multi_line
```

```yaml
  parsers.conf: |
    [PARSER]
        Name        docker
        Format      json
        Time_Key    time
        Time_Format %Y-%m-%dT%H:%M:%S.%L
        Time_Keep   On  
        # Command      |  Decoder | Field | Optional Action
        # =============|==================|=================
        Decode_Field_As   escaped    log 
    [PARSER]
        Name multi_line
        Format regex
        Regex (?<log>^{"log":"\d{4}-\d{2}-\d{2}.*)
 ```
