add_library(fabm_models_ecosmoe2e OBJECT
            ecosmoe2e_model_library.F90
	    ecosmomb.F90
	    ecosmofish.F90
           )

add_dependencies(fabm_models_ecosmoe2e fabm_base)
