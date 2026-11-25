# StrainFighter

Jogo de luta idle da IdleRite Games com lutadores botânicos fictícios. As lutas
avançam sozinhas. Escolha um dos três estilos, use o especial quando estiver
carregado e gaste fichas para treinar seu lutador. O progresso fica salvo no
navegador, com até duas horas de simulação offline de fichas, vitórias e XP
para o lutador ativo.

## Jogar

Execute `python3 -m http.server 8000 --directory docs` e abra
`http://localhost:8000`. A pasta `docs/` inclui os arquivos WASM da demo.

Para sincronizar o save com SQLite, rode `cargo run --locked -p idlerite-server`
no repo vizinho IdleRite e abra `http://127.0.0.1:8080/strain-fighter/`.
Use **Exportar save** e **Importar save** para trazer o progresso de uma demo
aberta em outro domínio ou porta.

Os idiomas PT-BR, inglês e espanhol acompanham a preferência usada no hub e no
Gunkyard. A arena ocupa a tela com barras de vida e comandos sobre o combate.
Use os painéis de Lutadores e Salvamento para trocar de personagem ou gerenciar
o progresso. A arena usa sprites e efeitos em Canvas 2D. Lemon Haze usa Corte
Cítrico e Raio Limão, Purple Kush usa Ombro Roxo e Abalo Violeta, e Mango Punch
usa Chute Solar e Vórtice Solar. O combate respeita o movimento reduzido.

## Progressão

O circuito tem nove rivais. A primeira vitória sobre cada um dá uma peça
exclusiva. No painel de equipamento, equipe um item de punhos e um amuleto
por lutador, transfira peças entre eles ou melhore cada item até +5 com fichas.
Use o painel de rivais para repetir uma etapa liberada e retomar o avanço
automático quando quiser.

Vitórias e derrotas rendem XP para o lutador ativo. A maestria aumenta ataque
e vida, e a 45 e 160 XP libera técnicas diferentes para cada lutador.
Lemon Haze ganha carga extra e reforça os golpes após seu especial. Purple
Kush reduz o dano recebido e protege os contra-ataques após seu especial.
Mango Punch reforça cada quarto golpe e se cura ao usar o especial.

Saves anteriores conservam treino, fichas e campanha. As vitórias que já
estavam registradas no circuito também desbloqueiam as peças correspondentes.

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
