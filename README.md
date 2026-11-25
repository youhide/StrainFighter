# StrainFighter

Jogo de luta idle da IdleRite Games com lutadores botânicos fictícios. As lutas
avançam sozinhas. Escolha um dos três estilos, use o especial quando estiver
carregado e gaste fichas para treinar seu lutador. O progresso fica salvo no
navegador, com até duas horas de simulação offline de fichas, vitórias e XP
para o lutador ativo.

## Jogar

O frontend de produção fica em `web/`. Ele contém o HTML, os sprites 2D e
o adaptador WebAssembly para a arena. As regras em Rust ficam em `src/`.

Para jogar com mercado e progresso no servidor, rode
`cargo run --locked -p idlerite-server` no repo vizinho IdleRite e abra
[StrainFighter](http://127.0.0.1:8080/strain-fighter/). O servidor usa SQLite
para guardar o saldo e as peças do perfil visitante.

Para jogar a campanha local, execute `python3 -m http.server 8000 --directory web`
e abra `http://localhost:8000`. No site da IdleRite, **Salvamento →
Abrir campanha anterior** dá acesso aos saves anteriores. Essa campanha tem
demonstração offline e importação de saves próprias.

## Mercado de equipamentos

O mercado fica dentro do jogo e em
[Mercado do StrainFighter](http://127.0.0.1:8080/mercado/strain-fighter)
com o mesmo perfil, inventário e saldo. Anuncie peças desequipadas por
fichas, cancele ofertas abertas ou compre equipamento de outros jogadores.
Cada perfil pode ter uma peça por tipo. A caixa de melhoria custa 40 fichas
e dá 55% de chance de manter o nível, 35% de subir +1 e 10% de subir +2, com
teto de +5.

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
wasm-bindgen --target web --no-typescript --out-dir web/wasm \
  target/wasm32-unknown-unknown/release/strain_fighter.wasm
```
