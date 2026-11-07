add_library(fabm_models_e2e OBJECT
            model_library.F90
            e2e_models.F90
           )

target_link_libraries(fabm_models_e2e PRIVATE fabm_base)
