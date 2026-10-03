#!/usr/bin/env node
// Prints the machine's memory as one JSON line: { total, free } in bytes.
import { freemem, totalmem } from 'node:os'

process.stdout.write(JSON.stringify({ total: totalmem(), free: freemem() }) + '\n')
