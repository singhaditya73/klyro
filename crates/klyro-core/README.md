# klyro-core

The always-on daemon behind Klyro. It owns the hot path — the hotkey, the
capture, the provider call, the answer — so the overlay opens in milliseconds
instead of seconds.

See [`docs/DAEMON.md`](../../docs/DAEMON.md) for the protocol and the
numbers.

```sh
cargo build --release
./target/release/klyro-core
```

MIT, like the rest of Klyro.
