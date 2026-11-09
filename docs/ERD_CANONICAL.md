# ExtraChef — ERD Canônico (Provisório)

**Status: NÃO CANÔNICO — dependências inferidas das migrations**

Um ERD fiel do banco remoto não pode ser produzido com as evidências atuais: não há DDL de catálogo nem export de schema. Este arquivo registra somente relações/referências demonstradas pelo histórico versionado e não pretende listar todas as colunas, chaves ou constraints.

```mermaid
erDiagram
    AUTH_USERS ||--o| USERS : "id espelhado / dependência assumida"
    USERS ||--o| WORKER_PROFILES : "user_id"
    USERS ||--o| RESTAURANT_PROFILES : "user_id"
    USERS ||--o{ JOBS : "papel depende de DDL base não versionado"
    USERS ||--o{ APPLICATIONS : "papel depende de DDL base não versionado"
    JOBS ||--o{ APPLICATIONS : "relação de domínio assumida"
    USERS ||--o{ OPERATIONAL_ASSIGNMENTS : "ator/profissional conforme migrations"
    JOBS ||--o{ OPERATIONAL_ASSIGNMENTS : "contexto operacional conforme migrations"
    USERS ||--o{ REVIEWS : "participantes conforme migrations"
    JOBS ||--o{ REVIEWS : "relação de operação conforme migrations"
    WORKER_PROFILES }o..o{ STORAGE_OBJECTS : "selfie_verification_path em worker-private"
    STAFF_MEMBERS }o..|| AUTH_USERS : "proposta do blueprint; ainda não existe"
    ADMIN_AUDIT_LOG }o..|| AUTH_USERS : "ator proposto; ainda não existe"
```

### Grau de evidência

| Relação/objeto | Evidência | Status |
|---|---|---|
| `worker_profiles.user_id → users.id` | DDL de `20261014050000_profiles_and_geo.sql` | ✅ Referência versionada |
| `restaurant_profiles.user_id → users.id` | DDL de `20261014050000_profiles_and_geo.sql` | ✅ Referência versionada |
| Relações de `jobs`/`applications` | Migrations de domínio fazem uso e impõem regras sobre essas tabelas, mas DDL inicial ausente | ⚠ Estrutura/constraints exatas desconhecidas |
| `operational_assignments`, `reviews` e usuários/vagas | Migrations de confiança operacional/reviews | ⚠ Confirmar FK e cardinalidade no catálogo remoto |
| Storage de selfie | Path guardado em `worker_profiles.selfie_verification_path`; objeto em `storage.objects`/`worker-private` | ✅ Dependência lógica; não é FK relacional |
| `staff_members`, `admin_audit_log` | Apenas arquitetura proposta em documentos | ❌ Ainda não existem no código/migrations |

O modelo final deve ser regenerado/revisado a partir do DDL do ambiente, incluindo todas as FKs, cardinalidades, constraints e tabelas de apoio. Não usar este diagrama provisório para gerar migrations.
