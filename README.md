# StrainFighter

Jogo de luta idle da IdleRite Games com lutadores botânicos fictícios. As lutas
avançam sozinhas. Escolha um dos três estilos, use o especial quando estiver
carregado e gaste fichas para treinar seu lutador. O progresso fica salvo no
navegador, com até duas horas de simulação offline.

## Jogar

Execute `python3 -m http.server 8000 --directory docs` e abra
`http://localhost:8000`. A pasta `docs/` inclui os arquivos WASM da demo.

## Desenvolvimento

As regras rodam em Rust e usam a biblioteca IdleRite. Para recompilar, tenha
acesso SSH ao repositório privado da engine.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
export CARGO_NET_GIT_FETCH_WITH_CLI=true
cargo test --locked
cargo build --locked --release --target wasm32-unknown-unknown --target-dir target
wasm-bindgen --target web --no-typescript --out-dir docs/wasm \
  target/wasm32-unknown-unknown/release/strain_fighter.wasm
```
